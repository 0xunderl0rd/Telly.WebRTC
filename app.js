// DOM Elements
const connectBtn = document.getElementById('connectBtn');
const transcript = document.getElementById('transcript');
const status = document.getElementById('status');
const imageUpload = document.getElementById('imageUpload');

// State
let isConnected = false;
let peerConnection = null;
let audioStream = null;
let dataChannel = null;
let audioContext = null;
let audioMeter = null;

// Constants
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB in bytes
const SERVER_URL = 'http://localhost:3000';
const OPENAI_REALTIME_URL = 'https://api.openai.com/v1/realtime';
const MODEL = 'gpt-4o-realtime-preview-2024-12-17';

// Utility Functions
function updateStatus(message, isError = false) {
    status.textContent = `Status: ${message}`;
    status.style.color = isError ? '#dc3545' : '#666';
    console.log(`Status Update: ${message}`);
}

function logError(error) {
    console.error('Error:', error);
    updateStatus(error.message || error, true);
}

function addMessageToTranscript(message, isUser = false, type = 'text') {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isUser ? 'user-message' : 'agent-message'}`;
    
    if (type === 'status') {
        messageDiv.style.fontStyle = 'italic';
        messageDiv.style.color = '#666';
    }
    
    messageDiv.textContent = message;
    transcript.appendChild(messageDiv);
    transcript.scrollTop = transcript.scrollHeight;
}

// Audio Visualization
function setupAudioMeter() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    
    const mediaStreamSource = audioContext.createMediaStreamSource(audioStream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    
    mediaStreamSource.connect(analyser);
    
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    function updateMeter() {
        if (!isConnected) return;
        
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
        }
        const average = sum / bufferLength;
        
        // Update status with audio level indicator
        const level = '█'.repeat(Math.floor(average / 10));
        updateStatus(`Connected | Audio Level: ${level}`);
        
        requestAnimationFrame(updateMeter);
    }
    
    updateMeter();
}

// WebRTC Setup
async function setupWebRTC() {
    try {
        updateStatus('Initializing...');
        addMessageToTranscript('Initializing connection...', false, 'status');

        // Get ephemeral token from our server
        const tokenResponse = await fetch(`${SERVER_URL}/session`);
        if (!tokenResponse.ok) {
            throw new Error('Failed to get session token');
        }
        const sessionData = await tokenResponse.json();
        const ephemeralKey = sessionData.client_secret.value;
        addMessageToTranscript('Session token obtained', false, 'status');

        // Request microphone access with specific constraints
        audioStream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 48000,
                channelCount: 1
            } 
        });
        updateStatus('Microphone access granted');
        addMessageToTranscript('Microphone access granted', false, 'status');

        // Create peer connection
        peerConnection = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        });

        // Set up audio playback with specific settings
        const audioEl = document.createElement('audio');
        audioEl.autoplay = true;
        audioEl.volume = 1.0; // Ensure volume is at maximum
        document.body.appendChild(audioEl);
        
        // Handle incoming audio stream
        peerConnection.ontrack = (event) => {
            console.log('Received audio track:', event.streams[0]);
            audioEl.srcObject = event.streams[0];
            addMessageToTranscript('Receiving audio stream', false, 'status');
        };

        // Add local audio track with specific settings
        const audioTrack = audioStream.getAudioTracks()[0];
        if (audioTrack) {
            console.log('Adding audio track:', audioTrack.getSettings());
            peerConnection.addTrack(audioTrack, audioStream);
        }

        // Setup audio visualization
        setupAudioMeter();

        // Create data channel for events
        dataChannel = peerConnection.createDataChannel('oai-events', {
            ordered: true
        });
        setupDataChannelHandlers();

        // Create and set local description with specific audio settings
        const offer = await peerConnection.createOffer({
            offerToReceiveAudio: true,
            voiceActivityDetection: true
        });
        await peerConnection.setLocalDescription(offer);
        addMessageToTranscript('Local description set', false, 'status');

        // Send offer to OpenAI
        const sdpResponse = await fetch(`${OPENAI_REALTIME_URL}?model=${MODEL}`, {
            method: 'POST',
            body: offer.sdp,
            headers: {
                'Authorization': `Bearer ${ephemeralKey}`,
                'Content-Type': 'application/sdp'
            }
        });

        if (!sdpResponse.ok) {
            throw new Error('Failed to get SDP answer');
        }

        // Set remote description
        const answer = {
            type: 'answer',
            sdp: await sdpResponse.text()
        };
        await peerConnection.setRemoteDescription(answer);
        addMessageToTranscript('Remote description set', false, 'status');

        // Update UI state
        isConnected = true;
        connectBtn.textContent = 'Disconnect';
        updateStatus('Connected');

    } catch (error) {
        logError(error);
        cleanupWebRTC();
    }
}

function setupDataChannelHandlers() {
    dataChannel.onopen = () => {
        updateStatus('Data channel open');
        addMessageToTranscript('Connection established', false, 'status');
        
        // Send initial prompt after data channel is open
        sendEvent({
            type: 'response.create',
            response: {
                modalities: ['text', 'audio'],
                instructions: "Hello! I'm your AI assistant. You can speak to me, and I'll respond with both voice and text. I can also analyze images if you upload them. What would you like to discuss?"
            }
        });
    };

    dataChannel.onclose = () => {
        updateStatus('Data channel closed');
        addMessageToTranscript('Connection closed', false, 'status');
    };

    dataChannel.onerror = (error) => {
        logError('Data channel error: ' + error);
    };

    dataChannel.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            handleRealtimeEvent(message);
        } catch (error) {
            logError('Failed to parse message: ' + error);
        }
    };
}

function handleRealtimeEvent(event) {
    console.log('Received event:', event);
    
    switch (event.type) {
        case 'session.created':
            console.log('Session:', event.session);
            addMessageToTranscript(`Session created with model: ${event.session.model}`, false, 'status');
            break;
            
        case 'session.updated':
            console.log('Session updated:', event.session);
            break;
            
        case 'input_audio_buffer.speech_started':
            updateStatus('Speaking...');
            break;
            
        case 'input_audio_buffer.speech_stopped':
            updateStatus('Processing speech...');
            break;
            
        case 'input_audio_buffer.committed':
            updateStatus('Connected');
            break;
            
        case 'conversation.item.created':
            console.log('Conversation item:', event.item);
            if (event.item?.type === 'message' && event.item?.message?.content) {
                // Handle user message transcription
                const content = event.item.message.content;
                if (content.type === 'text' && content.text) {
                    addMessageToTranscript(`🎤 ${content.text}`, true);
                }
            }
            break;
            
        case 'response.created':
            updateStatus('Assistant is responding...');
            break;
            
        case 'response.done':
            updateStatus('Connected');
            break;
            
        case 'text.created':
            if (event.text?.value) {
                addMessageToTranscript(`🤖 ${event.text.value}`, false);
            }
            break;

        case 'error':
            logError(event.error);
            break;
            
        default:
            console.log('Unhandled event type:', event.type, event);
    }
}

function sendEvent(event) {
    if (dataChannel && dataChannel.readyState === 'open') {
        dataChannel.send(JSON.stringify(event));
    } else {
        logError('Data channel not ready');
    }
}

function cleanupWebRTC() {
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }

    if (audioStream) {
        audioStream.getTracks().forEach(track => track.stop());
        audioStream = null;
    }

    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    if (dataChannel) {
        dataChannel.close();
        dataChannel = null;
    }

    isConnected = false;
    connectBtn.textContent = 'Connect';
    updateStatus('Disconnected');
    addMessageToTranscript('Connection cleaned up', false, 'status');
}

// Image Handling
imageUpload.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (file.size > MAX_IMAGE_SIZE) {
        logError(new Error('Image size exceeds 10MB limit'));
        return;
    }

    try {
        const reader = new FileReader();
        reader.onload = () => {
            const img = document.createElement('img');
            img.src = reader.result;
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message user-message';
            messageDiv.appendChild(img);
            transcript.appendChild(messageDiv);

            // Send image analysis request through data channel
            sendEvent({
                type: 'response.create',
                response: {
                    modalities: ['text', 'audio'],
                    instructions: 'Please analyze this image.',
                    image: reader.result
                }
            });
        };
        reader.readAsDataURL(file);
    } catch (error) {
        logError(error);
    }
});

// Event Listeners
connectBtn.addEventListener('click', async () => {
    if (isConnected) {
        cleanupWebRTC();
    } else {
        await setupWebRTC();
    }
});

// Handle page unload
window.addEventListener('beforeunload', cleanupWebRTC); 