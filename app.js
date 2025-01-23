// DOM Elements
const connectBtn = document.getElementById('connectBtn');
const transcript = document.getElementById('transcript');
const status = document.getElementById('status');
const imageUpload = document.getElementById('imageUpload');

// State
let isConnected = false;
let peerConnection = null;
let audioStream = null;

// Constants
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB in bytes

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
        // Request microphone access
        audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // Create and configure peer connection
        const configuration = { 
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        };
        
        peerConnection = new RTCPeerConnection(configuration);
        
        // Add audio track to peer connection
        audioStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, audioStream);
        });

        // Handle connection state changes
        peerConnection.onconnectionstatechange = () => {
            updateStatus(`Connection: ${peerConnection.connectionState}`);
            if (peerConnection.connectionState === 'connected') {
                isConnected = true;
                connectBtn.textContent = 'Disconnect';
            }
        };

        // Handle ICE candidate events
        peerConnection.onicecandidate = event => {
            if (event.candidate) {
                // TODO: Send ICE candidate to OpenAI server
                console.log('New ICE candidate:', event.candidate);
            }
        };

        // TODO: Implement signaling with OpenAI server
        
    } catch (error) {
        logError(error);
        cleanupWebRTC();
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
        // TODO: Implement image processing and sending to OpenAI
        const reader = new FileReader();
        reader.onload = () => {
            const img = document.createElement('img');
            img.src = reader.result;
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message user-message';
            messageDiv.appendChild(img);
            transcript.appendChild(messageDiv);
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