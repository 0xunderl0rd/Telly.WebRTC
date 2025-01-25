	1.	Search the Entire Codebase for “response.messages”
	•	Open your text editor and run a global search (e.g., “Find in Files”) for any place where your code references response.messages.
	•	Even if you think you removed all references, ensure there’s no leftover snippet that still tries to send "messages" or "content" under response.
	2.	Remove or Rename Unsupported Keys
	•	According to the Realtime API documentation, response.create only supports top-level fields like modalities, instructions, voice, etc.
	•	If you find code referencing response.messages or response.content, delete that key or replace it with a field the API actually supports (usually instructions).
	•	Example (pseudocode):

sendEvent({
  type: 'response.create',
  response: {
    modalities: ['audio', 'text'],
    instructions: "Put your text here",
    voice: "sage"
  }
});


	3.	Remove Any Other Unknown Fields Like image
	•	Your code also sends image: reader.result in a response.create call.
	•	Check the docs to see if the Realtime API supports an image field. It does not list “image” as a valid field under response.
	•	If you need to send an image for analysis, consider a different approach, such as creating a function call or a conversation item with some special “content: [ { type: ‘image’, … } ]”.
	4.	Use instructions to Make the Model Speak the Perplexity Text
	•	The Realtime docs show that instructions is the main field for telling the model what to say.
	•	If you want your assistant to speak the text retrieved from Perplexity, put that summary inside the instructions string.
	•	For instance:

sendEvent({
  type: "response.create",
  response: {
    modalities: ["audio", "text"],
    instructions: "Please summarize these findings out loud: " + searchResult.text,
    voice: selectedVoice
  }
});


	5.	Avoid Attempting to Send Arrays of Messages
	•	The Realtime API does not accept a messages array inside response.create.
	•	If you want to create a conversation item with user content, you can use conversation.item.create.
	•	If you want the assistant to generate a new “assistant message,” you can just send instructions with response.create.
	6.	Double-Check Your Error-Handling Logic
	•	The code attempts to reconnect when an error event arrives. Make sure that logic doesn’t repeatedly close the connection for a minor “unknown_parameter” error.
	•	Remove or disable reconnection code that triggers on invalid_request_error so you can confirm the request goes through correctly once you fix the unknown parameter.
	7.	Retest with Fresh Changes
	•	After removing references to response.messages, response.content, or image in the wrong place, restart your server.
	•	Reload your frontend, connect again, and ask a question that triggers your web search.
	•	Confirm the text logs show no “unknown parameter” errors and that the TTS audio streams back to you.
	8.	Document the Fix
	•	In your commit, list exactly which lines were changed.
	•	Reference “Removed references to ‘response.messages’ so the Realtime API no longer returns unknown_parameter errors” or similar.
	•	This helps your team understand the root cause and the resolution.