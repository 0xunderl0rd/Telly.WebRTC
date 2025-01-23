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
    if (!message) return; // Don't add empty messages
    
    // Create container for proper message flow
    const container = document.createElement('div');
    container.className = 'message-container';
    
    if (type === 'status') {
        // System status messages
        const messageDiv = document.createElement('div');
        messageDiv.className = 'system-message';
        messageDiv.textContent = message;
        container.appendChild(messageDiv);
    } else {
        // User or agent messages
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isUser ? 'user-message' : 'agent-message'}`;
        
        // Add role indicator
        const roleSpan = document.createElement('span');
        roleSpan.className = 'role-indicator';
        roleSpan.textContent = isUser ? '🎤 You: ' : '🤖 Assistant: ';
        roleSpan.style.fontWeight = 'bold';
        messageDiv.appendChild(roleSpan);
        
        // Add message text
        const textSpan = document.createElement('span');
        textSpan.textContent = message;
        messageDiv.appendChild(textSpan);
        
        container.appendChild(messageDiv);
        
        // Add a clear div to maintain proper flow
        const clearDiv = document.createElement('div');
        clearDiv.className = 'clear-both';
        container.appendChild(clearDiv);
    }
    
    transcript.appendChild(container);
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
        updateStatus('Connected');
        addMessageToTranscript('Ready to chat', false, 'status');
        
        // Send initial prompt
        sendEvent({
            type: 'response.create',
            response: {
                modalities: ['text', 'audio'],
                instructions: "Hi! I'm ready to chat. You can speak to me, and I'll respond with both voice and text."
            }
        });
    };

    dataChannel.onclose = () => {
        updateStatus('Disconnected');
        addMessageToTranscript('Connection closed', false, 'status');
    };

    dataChannel.onerror = (error) => {
        logError('Data channel error: ' + error);
    };

    dataChannel.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            console.log('Received message:', message); // Log all messages
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
            addMessageToTranscript('Session started', false, 'status');
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
            console.log('Conversation item created:', event.item);
            if (event.item?.type === 'message') {
                if (event.item?.message?.role === 'user' && event.item?.message?.content?.type === 'text') {
                    // User's transcribed speech
                    console.log('User speech transcript:', event.item.message.content.text);
                    addMessageToTranscript(event.item.message.content.text, true);
                }
                else if (event.item?.message?.role === 'assistant' && event.item?.message?.content?.type === 'text') {
                    // Assistant's text response
                    console.log('Assistant response:', event.item.message.content.text);
                    addMessageToTranscript(event.item.message.content.text, false);
                }
            } else if (event.item?.type === 'text') {
                // Direct text content
                console.log('Direct text content:', event.item.text);
                if (event.item.text) {
                    addMessageToTranscript(event.item.text, event.item.role === 'user');
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
            console.log('Text created:', event.text);
            if (event.text?.value) {
                addMessageToTranscript(event.text.value, false);
            }
            break;

        case 'error':
            console.error('Error event:', event.error);
            logError(event.error);
            addMessageToTranscript(`Error: ${event.error.message || 'Unknown error'}`, false, 'status');
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