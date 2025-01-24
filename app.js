// DOM Elements
const connectBtn = document.getElementById('connectBtn');
const transcript = document.getElementById('transcript');
const status = document.getElementById('status');
const imageUpload = document.getElementById('imageUpload');
const voiceSelect = document.getElementById('voiceSelect');

// State
let isConnected = false;
let peerConnection = null;
let audioStream = null;
let dataChannel = null;
let audioContext = null;
let audioMeter = null;
let currentAssistantMessage = '';
let lastMessageRole = null;
let selectedVoice = 'sage'; // Default voice
let messageBuffer = {
    text: '',
    timeout: null,
    functionCall: null  // Add function call tracking
};

// Add image state tracking
let lastImageContext = {
    prompt: null,
    url: null,
    timestamp: null
};

// Constants
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB in bytes
const SERVER_URL = 'http://localhost:3000';
const OPENAI_REALTIME_URL = 'https://api.openai.com/v1/realtime';
const MODEL = 'gpt-4o-realtime-preview-2024-12-17';

// Add voice selection handler
voiceSelect.addEventListener('change', (event) => {
    selectedVoice = event.target.value;
    if (isConnected) {
        addMessageToTranscript(`Switching to ${selectedVoice} voice requires reconnecting...`, false, 'status');
    }
});

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

        // Get ephemeral token from our server with selected voice
        const tokenResponse = await fetch(`${SERVER_URL}/session?voice=${encodeURIComponent(selectedVoice)}`);
        if (!tokenResponse.ok) {
            const errorData = await tokenResponse.json();
            throw new Error(`Failed to get session token: ${errorData.error || tokenResponse.statusText}`);
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
        audioEl.volume = 1.0;
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

        // Send offer to OpenAI with input audio transcription enabled and selected voice
        const sdpResponse = await fetch(`${OPENAI_REALTIME_URL}?model=${MODEL}`, {
            method: 'POST',
            body: offer.sdp,
            headers: {
                'Authorization': `Bearer ${ephemeralKey}`,
                'Content-Type': 'application/sdp',
                'OpenAI-Beta': 'realtime'
            },
            // Add input audio transcription configuration and voice selection
            query: {
                input_audio_transcription: {
                    model: 'whisper-1'
                },
                voice: selectedVoice
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
        updateStatus(`Connected (${selectedVoice})`);

    } catch (error) {
        logError(error);
        cleanupWebRTC();
    }
}

function setupDataChannelHandlers() {
    dataChannel.onopen = () => {
        updateStatus('Connected');
        addMessageToTranscript('Ready to chat', false, 'status');
        
        // Send initial prompt with detailed instructions
        sendEvent({
            type: 'response.create',
            response: {
                modalities: ['text', 'audio'],
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

function flushMessageBuffer() {
    if (messageBuffer.text.trim()) {
        addMessageToTranscript(messageBuffer.text.trim(), false);
        messageBuffer.text = '';
    }
    if (messageBuffer.timeout) {
        clearTimeout(messageBuffer.timeout);
        messageBuffer.timeout = null;
    }
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
            
        case 'input_audio_buffer.transcription':
            // Handle Whisper transcription events
            console.log('Transcription received:', event.transcription);
            if (event.transcription?.text) {
                addMessageToTranscript(event.transcription.text, true);
            }
            break;
            
        case 'input_audio_buffer.speech_started':
            updateStatus('Speaking...');
            lastMessageRole = 'user';
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
                // Reset message buffer when switching speakers
                if (lastMessageRole !== event.item.role) {
                    flushMessageBuffer();
                    lastMessageRole = event.item.role;
                }

                // Handle user transcripts
                if (event.item.role === 'user') {
                    // Check all content parts for text
                    const textContent = event.item.content?.find(c => c.type === 'text');
                    if (textContent?.text) {
                        console.log('User speech transcript:', textContent.text);
                        addMessageToTranscript(textContent.text, true);
                    }
                }
            }
            break;
            
        case 'response.created':
            updateStatus('Assistant is responding...');
            messageBuffer.text = '';
            lastMessageRole = 'assistant'; // Track that assistant is speaking
            if (messageBuffer.timeout) {
                clearTimeout(messageBuffer.timeout);
                messageBuffer.timeout = null;
            }
            break;
            
        case 'response.done':
            // Final cleanup of any remaining text
            flushMessageBuffer();
            updateStatus('Connected');
            break;

        case 'response.audio_transcript.delta':
            if (event.delta) {
                // Reset function call state to ensure clean transcript handling
                if (messageBuffer.functionCall) {
                    messageBuffer.functionCall = null;
                }
                
                messageBuffer.text += event.delta;
                
                // Clear any existing timeout
                if (messageBuffer.timeout) {
                    clearTimeout(messageBuffer.timeout);
                }
                
                // Check for natural breakpoints
                const hasNaturalBreak = /[.!?]\s*$/.test(messageBuffer.text) || 
                                      /[,;:]\s*$/.test(messageBuffer.text) ||
                                      messageBuffer.text.length > 100;
                
                if (hasNaturalBreak) {
                    flushMessageBuffer();
                } else {
                    // Set a timeout to flush the buffer if no new content arrives
                    messageBuffer.timeout = setTimeout(() => {
                        flushMessageBuffer();
                    }, 1000);
                }
            }
            break;

        case 'response.output_item.added':
            console.log('Output item added:', event.item);
            if (event.item?.type === 'message' && event.item?.content?.[0]?.type === 'text') {
                const text = event.item.content[0].text;
                if (event.item.role === 'user') {
                    addMessageToTranscript(text, true);
                }
            }
            break;

        case 'response.content_part.added':
            console.log('Content part added:', event.part);
            if (event.part?.type === 'text' && event.part?.text) {
                addMessageToTranscript(event.part.text, false);
            }
            break;

        case 'response.audio.done':
            flushMessageBuffer();
            console.log('Audio response completed');
            updateStatus('Connected');
            break;
            
        case 'error':
            console.error('Error event:', event.error);
            logError(event.error);
            addMessageToTranscript(`Error: ${event.error.message || 'Unknown error'}`, false, 'status');
            break;
            
        case 'rate_limits.updated':
            // Just log rate limits, no action needed
            console.log('Rate limits updated:', event.rate_limits);
            break;

        case 'response.function_call_arguments.delta':
            console.log('Function call delta received:', {
                call_id: event.call_id,
                delta: event.delta,
                current_buffer: messageBuffer.functionCall?.arguments
            });
            // Accumulate function call arguments
            if (!messageBuffer.functionCall) {
                messageBuffer.functionCall = {
                    name: event.call_id,
                    arguments: ''
                };
            }
            if (event.delta) {
                messageBuffer.functionCall.arguments += event.delta;
            }
            break;

        case 'response.function_call_arguments.done':
            console.log('Function call arguments completed:', {
                name: event.name,
                raw_args: event.arguments
            });
            
            try {
                // Parse the arguments directly from the event
                const args = JSON.parse(event.arguments);
                console.log('Parsed function arguments:', args);
                
                if (event.name === 'generate_image' && args.prompt) {
                    generateImage(args.prompt);
                }
            } catch (error) {
                console.error('Error parsing function arguments:', error);
                console.log('Raw arguments:', event.arguments);
            }
            
            // Clear only the function call buffer, preserve other message state
            messageBuffer.functionCall = null;
            break;

        case 'response.output_item.done':
            if (event.item?.type === 'function_call') {
                console.log('Function call item completed:', event.item);
            } else {
                // Ensure any remaining text is flushed
                flushMessageBuffer();
            }
            break;

        default:
            // Log unhandled event types but don't show error
            console.log('Unhandled event type:', event.type, event);
            break;
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

// Image Generation
async function generateImage(prompt) {
    try {
        // Add loading indicator
        const loadingContainer = document.createElement('div');
        loadingContainer.className = 'message agent-message';
        loadingContainer.innerHTML = `
            <div class="loading-container">
                <div class="loading-spinner"></div>
                <div class="loading-text">Generating image: ${prompt}</div>
            </div>
        `;
        transcript.appendChild(loadingContainer);
        transcript.scrollTop = transcript.scrollHeight;

        // Make API call to our server endpoint
        const response = await fetch(`${SERVER_URL}/generate-image`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ prompt })
        });

        if (!response.ok) {
            throw new Error('Failed to generate image');
        }

        const data = await response.json();

        // Remove loading indicator
        loadingContainer.remove();

        // Create image container
        const imageContainer = document.createElement('div');
        imageContainer.className = 'message agent-message';
        
        // Create and add image
        const img = document.createElement('img');
        img.src = data.url;
        img.alt = prompt;
        img.className = 'generated-image';
        imageContainer.appendChild(img);
        
        // Add to transcript
        transcript.appendChild(imageContainer);
        transcript.scrollTop = transcript.scrollHeight;

        // Update last image context
        lastImageContext = {
            prompt,
            url: data.url,
            timestamp: Date.now()
        };

    } catch (error) {
        console.error('Error generating image:', error);
        addMessageToTranscript('Failed to generate image: ' + error.message, false, 'status');
    }
} 