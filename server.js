import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Initialize environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = 3000;

// Enable CORS for our frontend
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Endpoint to get ephemeral token
app.get('/session', async (req, res) => {
    try {
        const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'gpt-4o-realtime-preview-2024-12-17',
                voice: 'sage',
                instructions: `You are a helpful voice assistant with image generation capabilities.
                    When users ask you to create, generate, draw, show, or make an image, use your generate_image tool.
                    Examples that should trigger image generation:
                    - "Create an image of..."
                    - "Can you show me..."
                    - "Generate a picture of..."
                    - "Draw me..."
                    - "Make an image of..."
                    
                    Keep your responses concise and natural.
                    Never mention the technical details of how you generate images.
                    After generating an image, briefly describe what you created.`,
                tools: [{
                    type: 'function',
                    name: 'generate_image',
                    description: 'Generate an image based on a natural language description. Use this whenever a user requests any kind of image creation or generation.',
                    parameters: {
                        type: 'object',
                        properties: {
                            prompt: {
                                type: 'string',
                                description: 'A detailed description of the image to generate'
                            }
                        },
                        required: ['prompt']
                    }
                }],
                tool_choice: 'auto'  // Let the model decide when to use the tool
            })
        });

        if (!response.ok) {
            throw new Error(`OpenAI API error: ${response.statusText}`);
        }

        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Start server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
}); 