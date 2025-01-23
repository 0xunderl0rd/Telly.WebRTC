# Voice Chat with OpenAI

A proof-of-concept application demonstrating real-time voice chat with OpenAI's API, including image analysis and generation capabilities.

## Setup

1. Clone this repository
2. Copy `.env` file and add your OpenAI API key:
   ```bash
   cp .env.example .env
   # Edit .env and add your API key
   ```
3. Open `index.html` in Chrome browser
   - Note: This proof of concept is designed to work in Chrome only

## Features

- Real-time voice chat using WebRTC
- Image upload and analysis (max 10MB)
- Simple, responsive UI
- Error logging and status updates

## Usage

1. Click the "Connect" button to start a session
2. Grant microphone permissions when prompted
3. Start speaking to interact with the AI
4. Upload images when requested by the AI
5. View the conversation transcript and status updates in real-time

## Development

This is a vanilla JavaScript application with no build step required. The main files are:

- `index.html`: Main UI structure
- `app.js`: Application logic and WebRTC handling
- `.env`: Configuration file for API keys

## Requirements

- Chrome browser
- OpenAI API key with access to real-time voice API
- Active internet connection for WebRTC and API communication 