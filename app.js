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

// Constants
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB in bytes
const SERVER_URL = 'http://localhost:3000';
const OPENAI_REALTIME_URL = 'https://api.openai.com/v1/realtime';
const MODEL = 'gpt-4o-realtime-preview-2024-12-17';

// Utility Functions
function updateStatus(message) {
    status.textContent = `Status: ${message}`;
    console.log(`Status Update: ${message}`);
}

function logError(error) {
    console.error('Error:', error);
    updateStatus(`Error: ${error.message || error}`);
}

function addMessageToTranscript(message, isUser = false) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isUser ? 'user-message' : 'agent-message'}`;
    messageDiv.textContent = message;
    transcript.appendChild(messageDiv);
    transcript.scrollTop = transcript.scrollHeight;
}

// WebRTC Setup
async function setupWebRTC() {
    try {
        updateStatus('Initializing...');

        // Get ephemeral token from our server
        const tokenResponse = await fetch(`${SERVER_URL}/session`);
        if (!tokenResponse.ok) {
            throw new Error('Failed to get session token');
        }
        const sessionData = await tokenResponse.json();
        const ephemeralKey = sessionData.client_secret.value;

        // Request microphone access
        audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        updateStatus('Microphone access granted');

        // Create peer connection
        peerConnection = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        });

        // Set up audio playback
        const audioEl = document.createElement('audio');
        audioEl.autoplay = true;
        document.body.appendChild(audioEl);
        
        peerConnection.ontrack = (event) => {
            audioEl.srcObject = event.streams[0];
        };

        // Add local audio track
        audioStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, audioStream);
        });

        // Create data channel for events
        dataChannel = peerConnection.createDataChannel('oai-events');
        setupDataChannelHandlers();

        // Create and set local description
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

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

        // Update UI state
        isConnected = true;
        connectBtn.textContent = 'Disconnect';
        updateStatus('Connected');

        // Send initial prompt
        sendEvent({
            type: 'response.create',
            response: {
                modalities: ['text', 'audio'],
                instructions: 'Hello! I am ready to chat.'
            }
        });

    } catch (error) {
        logError(error);
        cleanupWebRTC();
    }
}

function setupDataChannelHandlers() {
    dataChannel.onopen = () => {
        updateStatus('Data channel open');
    };

    dataChannel.onclose = () => {
        updateStatus('Data channel closed');
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
        case 'text.created':
            addMessageToTranscript(event.text.value, false);
            break;
        case 'error':
            logError(event.error);
            break;
        default:
            console.log('Unhandled event type:', event.type);
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