// DOM Elements
const connectBtn = document.getElementById('connectBtn');
const transcript = document.getElementById('transcript');
const status = document.getElementById('status');
const imageUpload = document.getElementById('imageUpload');
const voiceSelect = document.getElementById('voiceSelect');
const instructionsBtn = document.getElementById('instructionsBtn');
const instructionsModal = document.getElementById('instructionsModal');
const instructionsText = document.getElementById('instructionsText');
const saveInstructionsBtn = document.getElementById('saveInstructions');
const resetInstructionsBtn = document.getElementById('resetInstructions');
const closeModalBtn = document.querySelector('.close');

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
let customInstructions = null; // Store custom instructions
let messageBuffer = {
    text: '',
    timeout: null,
    functionCall: null,
    currentContainer: null  // Track current message container
};

// Add image state tracking
let lastImageContext = {
    prompt: null,
    url: null,
    timestamp: null
};

// Add this near the top with other state variables
let activeFunctionCalls = new Map();

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

// Instructions Modal Handling
async function fetchDefaultInstructions() {
    try {
        const response = await fetch(`${SERVER_URL}/default-instructions`);
        if (!response.ok) throw new Error('Failed to fetch default instructions');
        const data = await response.json();
        return data.instructions;
    } catch (error) {
        console.error('Error fetching default instructions:', error);
        return null;
    }
}

// Initialize instructions when the page loads
window.addEventListener('DOMContentLoaded', initializeInstructions);

async function initializeInstructions() {
    const defaultInstructions = await fetchDefaultInstructions();
    if (defaultInstructions) {
        instructionsText.value = customInstructions || defaultInstructions;
    }
}

instructionsBtn.onclick = async () => {
    // If there's no text in the textarea, try to load instructions
    if (!instructionsText.value) {
        const defaultInstructions = await fetchDefaultInstructions();
        if (defaultInstructions) {
            instructionsText.value = customInstructions || defaultInstructions;
        }
    }
    instructionsModal.style.display = 'block';
};

closeModalBtn.onclick = () => {
    instructionsModal.style.display = 'none';
};

window.onclick = (event) => {
    if (event.target === instructionsModal) {
        instructionsModal.style.display = 'none';
    }
};

saveInstructionsBtn.onclick = () => {
    const newInstructions = instructionsText.value.trim();
    if (newInstructions) {
        customInstructions = newInstructions;
        addMessageToTranscript('Instructions updated. Reconnect to apply changes.', false, 'status');
    }
    instructionsModal.style.display = 'none';
};

resetInstructionsBtn.onclick = async () => {
    const defaultInstructions = await fetchDefaultInstructions();
    if (defaultInstructions) {
        instructionsText.value = defaultInstructions;
        customInstructions = null;
        addMessageToTranscript('Instructions reset to default. Reconnect to apply changes.', false, 'status');
    }
};

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
    if (!message) return;
    
    // For status messages, always create a new container
    if (type === 'status') {
        const container = document.createElement('div');
        container.className = 'message-container';
        const messageDiv = document.createElement('div');
        messageDiv.className = 'system-message';
        messageDiv.textContent = message;
        container.appendChild(messageDiv);
        
        // Add clear div
        const clearDiv = document.createElement('div');
        clearDiv.className = 'clear-both';
        container.appendChild(clearDiv);
        
        transcript.appendChild(container);
        scrollToBottom();
        return;
    }

    // For regular messages, check if we should create a new container or use existing
    if (!messageBuffer.currentContainer || lastMessageRole !== (isUser ? 'user' : 'assistant')) {
        // Create new container for new speaker or first message
        const container = document.createElement('div');
        container.className = 'message-container';
        
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isUser ? 'user-message' : 'agent-message'}`;
        
        // Add role indicator
        const roleSpan = document.createElement('span');
        roleSpan.className = 'role-indicator';
        roleSpan.textContent = isUser ? '🎤 You: ' : '🤖 Assistant: ';
        roleSpan.style.fontWeight = 'bold';
        messageDiv.appendChild(roleSpan);
        
        // Add text span
        const textSpan = document.createElement('span');
        textSpan.className = 'message-text';
        textSpan.textContent = message;
        messageDiv.appendChild(textSpan);
        
        container.appendChild(messageDiv);
        
        // Add clear div
        const clearDiv = document.createElement('div');
        clearDiv.className = 'clear-both';
        container.appendChild(clearDiv);
        
        transcript.appendChild(container);
        messageBuffer.currentContainer = container;
    } else {
        // Update existing container's text
        const textSpan = messageBuffer.currentContainer.querySelector('.message-text');
        if (textSpan) {
            // Ensure we're not losing any text by checking if the new message contains the old one
            const existingText = textSpan.textContent;
            if (!message.includes(existingText)) {
                // If new message doesn't contain old message, append the delta
                textSpan.textContent = message;
            } else {
                // Otherwise use the new message as is
                textSpan.textContent = message;
            }
        }
    }
    
    scrollToBottom();
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
    
    // Handle errors first
    if (event.type === 'error') {
        console.error('Error event:', event.error);
        logError(event.error);
        
        // Only attempt reconnection for connection-related errors
        if (event.error.type === 'connection_error' || event.error.code === 'connection_closed') {
            addMessageToTranscript('Connection error occurred. Attempting to reconnect...', false, 'status');
            return;
        }
        return;
    }
    
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
            console.log('Conversation item created:', {
                type: event.item?.type,
                role: event.item?.role,
                content: event.item?.content,
                name: event.item?.name
            });
            if (event.item?.type === 'message') {
                // Only reset buffer when switching to user role
                if (lastMessageRole !== event.item.role && event.item.role === 'user') {
                    messageBuffer.text = '';
                    messageBuffer.currentContainer = null;
                }
                lastMessageRole = event.item.role;

                // Handle user transcripts
                if (event.item.role === 'user') {
                    const textContent = event.item.content?.find(c => c.type === 'text');
                    if (textContent?.text) {
                        console.log('User speech transcript:', textContent.text);
                        messageBuffer.text = textContent.text;
                        addMessageToTranscript(textContent.text, true);
                    }
                } else if (event.item.role === 'function') {
                    console.log('Function response received:', event.item);
                }
            }
            break;
            
        case 'response.created':
            updateStatus('Assistant is responding...');
            // Don't reset text buffer on new response, just the container if needed
            if (lastMessageRole !== 'assistant') {
                messageBuffer.currentContainer = null;
                lastMessageRole = 'assistant';
            }
            if (messageBuffer.timeout) {
                clearTimeout(messageBuffer.timeout);
                messageBuffer.timeout = null;
            }
            // Log the response creation
            console.log('New response created:', {
                id: event.response.id,
                modalities: event.response.modalities,
                status: event.response.status,
                type: event.type
            });
            break;
            
        case 'response.done':
            // Ensure any remaining text is displayed
            if (messageBuffer.text.trim()) {
                addMessageToTranscript(messageBuffer.text.trim(), false);
            }
            if (messageBuffer.timeout) {
                clearTimeout(messageBuffer.timeout);
                messageBuffer.timeout = null;
            }
            // Only reset container, keep the text for context
            messageBuffer.currentContainer = null;
            
            // Log response details for debugging
            console.log('Response completed:', {
                status: event.response.status,
                output: event.response.output,
                usage: event.response.usage,
                type: event.type
            });
            
            // Check if this was a file content response
            const fileResponse = event.response.output?.find(item => 
                item.type === 'message' && 
                item.content?.some(c => c.type === 'text' && c.text.includes('content from'))
            );
            
            if (fileResponse) {
                console.log('File content was processed by assistant');
            }
            
            updateStatus('Connected');
            break;

        case 'response.audio_transcript.delta':
            if (event.delta) {
                console.log('Received transcript delta:', event.delta);
                // Always append new delta to the buffer
                messageBuffer.text += event.delta;
                
                // Clear any existing timeout
                if (messageBuffer.timeout) {
                    clearTimeout(messageBuffer.timeout);
                }
                
                // Log the accumulated response
                if (event.delta.includes('content from') || event.delta.includes('documentation')) {
                    console.log('Assistant is processing file content:', messageBuffer.text);
                }
                
                addMessageToTranscript(messageBuffer.text, false);
                
                // Set a timeout just for very long pauses
                messageBuffer.timeout = setTimeout(() => {
                    // Don't clear the text buffer, just mark container as complete
                    messageBuffer.currentContainer = null;
                }, 3000);
                
                scrollToBottom();
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
            // Track the function call
            if (!activeFunctionCalls.has(event.call_id)) {
                activeFunctionCalls.set(event.call_id, {
                    name: event.name,
                    arguments: ''
                });
            }
            if (event.delta) {
                const call = activeFunctionCalls.get(event.call_id);
                call.arguments += event.delta;
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
                
                // Store function call info
                activeFunctionCalls.set(event.call_id, {
                    name: event.name,
                    arguments: args
                });
                
                if (event.name === 'generate_image' && args.prompt) {
                    generateImage(args.prompt);
                } else if (event.name === 'search_web') {
                    handleWebSearch(args).catch(error => {
                        console.error('Error in web search:', error);
                        addMessageToTranscript('Failed to complete the web search. Please try again.', false, 'status');
                    });
                } else if (event.name === 'retrieve_file') {
                    handleFileRetrieval(event.call_id, args).catch(error => {
                        console.error('Error in file retrieval:', error);
                        addMessageToTranscript('Failed to retrieve the documentation. Please try again.', false, 'status');
                    });
                }
            } catch (error) {
                console.error('Error parsing function arguments:', error);
                addMessageToTranscript('Failed to process the request. Please try again.', false, 'status');
            }
            break;

        case 'response.output_item.done':
            if (event.item?.type === 'function_call') {
                console.log('Function call item completed:', event.item);
            } else {
                // Ensure any remaining text is flushed
                flushMessageBuffer();
            }
            break;

        case 'output_audio_buffer.audio_stopped':
            // Silently handle audio stopped event
            break;

        default:
            // Just log unhandled event types without showing error
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
        loadingContainer.className = 'message-container';
        loadingContainer.innerHTML = `
            <div class="loading-container">
                <div class="loading-spinner"></div>
                <div class="loading-text">Generating image: ${prompt}</div>
            </div>
        `;
        transcript.appendChild(loadingContainer);
        scrollToBottom();

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

        // Create image container with proper message container structure
        const imageContainer = document.createElement('div');
        imageContainer.className = 'message-container';
        
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message agent-message';
        
        // Create and add image
        const img = document.createElement('img');
        img.src = data.url;
        img.alt = prompt;
        img.className = 'generated-image';
        messageDiv.appendChild(img);
        
        imageContainer.appendChild(messageDiv);
        
        // Add clear div after the image
        const clearDiv = document.createElement('div');
        clearDiv.className = 'clear-both';
        imageContainer.appendChild(clearDiv);
        
        // Add to transcript
        transcript.appendChild(imageContainer);
        scrollToBottom();

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

        // Get ephemeral token from our server with selected voice and custom instructions
        const params = new URLSearchParams({
            voice: selectedVoice,
            ...(customInstructions && { instructions: customInstructions })
        });
        
        const tokenResponse = await fetch(`${SERVER_URL}/session?${params}`);
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
    };

    dataChannel.onclose = () => {
        updateStatus('Disconnected');
        addMessageToTranscript('Connection closed', false, 'status');
        // Attempt to reconnect if not intentionally disconnected
        if (isConnected) {
            setTimeout(() => {
                console.log('Attempting to reconnect...');
                cleanupWebRTC();
                setupWebRTC();
            }, 2000);
        }
    };

    dataChannel.onerror = (error) => {
        console.error('Data channel error:', error);
        logError('Connection error occurred');
        
        // Only attempt recovery for connection-related errors
        if (isConnected && 
            dataChannel.readyState === 'closed' && 
            error.error?.message?.includes('connection')) {
            setTimeout(() => {
                console.log('Attempting to recover from connection error...');
                cleanupWebRTC();
                setupWebRTC();
            }, 2000);
        }
    };

    dataChannel.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            console.log('Received message:', message);
            
            // Handle errors without throwing
            if (message.type === 'error') {
                console.error('Received error message:', message.error);
                logError(message.error);
                return;
            }
            
            handleRealtimeEvent(message);
        } catch (error) {
            console.error('Failed to parse message:', error);
            logError('Failed to process message');
        }
    };
}

// Utility function to scroll transcript to bottom
function scrollToBottom(smooth = true) {
    transcript.scrollTo({
        top: transcript.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto'
    });
}

// Function to handle web search
async function handleWebSearch(args) {
    try {
        // Add a status message that we're searching
        addMessageToTranscript('Searching the web...', false, 'status');
        
        const searchResult = await performWebSearch(args.query, args.recency);
        
        // Display the search results in the transcript
        addMessageToTranscript(searchResult.text, false);
        
        // Add citations if available
        if (searchResult.citations?.length > 0) {
            const citationsContainer = document.createElement('div');
            citationsContainer.className = 'citations';
            citationsContainer.innerHTML = searchResult.citations
                .map(citation => `<a href="${citation.url}" target="_blank">[${citation.number}] ${citation.title}</a>`)
                .join('<br>');
            transcript.appendChild(citationsContainer);
            scrollToBottom();
        }

        // Send the results back to the agent using only supported fields
        sendEvent({
            type: 'response.create',
            response: {
                instructions: searchResult.text,
                voice: selectedVoice
            }
        });

    } catch (error) {
        console.error('Error in web search:', error);
        addMessageToTranscript('Failed to search the web. Please try again.', false, 'status');
        
        // Inform the agent about the error using only supported fields
        sendEvent({
            type: 'response.create',
            response: {
                instructions: 'I apologize, but I encountered an error while searching the web. Could you please try your request again?',
                voice: selectedVoice
            }
        });
    }
}

// Function to perform web search
async function performWebSearch(query, recency) {
    const loadingContainer = document.createElement('div');
    loadingContainer.className = 'loading-container';
    loadingContainer.innerHTML = `
        <div class="loading-spinner"></div>
        <div class="loading-text">Searching the web...</div>
    `;
    transcript.appendChild(loadingContainer);
    transcript.scrollTop = transcript.scrollHeight;

    try {
        console.log('Performing web search:', { query, recency });
        const response = await fetch(`${SERVER_URL}/search-web`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ query, recency })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to search web');
        }

        const data = await response.json();
        console.log('Search results:', data);
        return data;
    } catch (error) {
        console.error('Error searching web:', error);
        throw error;
    } finally {
        loadingContainer?.remove();
    }
}

// Update the handleFileRetrieval function
async function handleFileRetrieval(callId, args) {
    try {
        // Add a loading message
        addMessageToTranscript('Retrieving information from Telly documentation...', false, 'status');
        
        // Use the full server URL
        const response = await fetch(`${SERVER_URL}/api/files/${args.filename}`);
        if (!response.ok) {
            throw new Error(`Failed to retrieve file: ${response.statusText}`);
        }
        const data = await response.json();
        
        if (!data.success || !data.content) {
            throw new Error('Invalid file content received');
        }
        
        console.log('Successfully retrieved file content, sending to assistant');

        // Create a conversation item with the file content as an assistant message
        sendEvent({
            type: 'conversation.item.create',
            item: {
                type: 'message',
                role: 'assistant',
                content: [
                    {
                        type: 'text',
                        text: `Function retrieve_file was called with ${args.filename} and returned the following content:\n\n${data.content}`
                    }
                ]
            }
        });

        // Wait a brief moment for the conversation item to be processed
        await new Promise(resolve => setTimeout(resolve, 100));

        // Create a new response for the assistant to process the content
        sendEvent({
            type: 'response.create',
            response: {
                modalities: ['text', 'audio'],
                instructions: `Using the file content I just added to our conversation from ${args.filename}, provide a response that:
1. Is concise and limited to 30 words unless the user specifically asked for more detail
2. Maintains a competent and concise tone, helpful but not overly eager
3. Incorporates specific details from the documentation
4. Speaks quickly by default
5. Never mentions technical details about how you retrieved or processed the information

Remember to stay focused on answering the user's specific question without unnecessary elaboration.`,
                voice: selectedVoice
            }
        });
        
        console.log('Sent file content and created response for processing');
        
        // Clean up the function call tracking
        activeFunctionCalls.delete(callId);
        
    } catch (error) {
        console.error('Error retrieving file:', error);
        addMessageToTranscript('Failed to retrieve the documentation. Please try again.', false, 'status');
        
        // Send error as a conversation item
        sendEvent({
            type: 'conversation.item.create',
            item: {
                type: 'message',
                role: 'assistant',
                content: [
                    {
                        type: 'text',
                        text: `Error retrieving file: ${error.message}`
                    }
                ]
            }
        });

        // Wait a brief moment for the error item to be processed
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Create error response
        sendEvent({
            type: 'response.create',
            response: {
                modalities: ['text', 'audio'],
                instructions: `Maintain your concise and competent tone while informing the user that you encountered an error retrieving the documentation. Keep the response under 30 words and suggest they try their question again.`,
                voice: selectedVoice
            }
        });
        
        // Clean up even on error
        activeFunctionCalls.delete(callId);
    }
} 