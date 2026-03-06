document.addEventListener('DOMContentLoaded', () => {
    const chatWindow = document.getElementById('chat-window');
    const messageForm = document.getElementById('message-form');
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-button');
    const stopButton = document.getElementById('stop-button');

    // Focus the message input on page load so the user can start typing immediately
    messageInput.focus();

    const RESPONSE_ID_KEY = 'openai_previous_response_id';
    let controller = null;

    /**
     * A simple markdown-to-HTML converter.
     * Handles paragraphs, bold, and unordered lists.
     * @param {string} text The text to convert.
     * @returns {string} The formatted HTML.
     */
    const formatToHtml = (text) => {
        return text
            .trim()
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') // Bold
            .split('\n')
            .map(line => {
                line = line.trim();
                if (line.startsWith('- ') || line.startsWith('* ')) {
                    return `<ul><li>${line.substring(2)}</li></ul>`; // Unordered lists
                }
                if (line) {
                    return `<p>${line}</p>`; // Paragraphs
                }
                return '';
            })
            .join('')
            // This is a post-processing step to merge adjacent lists.
            .replace(/<\/ul><ul>/g, '');
    };
    
    const appendMessage = (sender, text, isHtml = false) => {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', `${sender}-message`);
        
        const contentDiv = document.createElement('div');
        if (isHtml) {
            contentDiv.innerHTML = text;
        } else {
            // For user messages, we still wrap in a <p> for consistent styling
            contentDiv.innerHTML = `<p>${text}</p>`;
        }
        
        messageElement.appendChild(contentDiv);
        chatWindow.appendChild(messageElement);
        chatWindow.scrollTop = chatWindow.scrollHeight;
        return messageElement;
    };
    
    messageForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const message = messageInput.value.trim();
        if (!message) return;

        appendMessage('user', message);
        messageInput.value = '';

        // Removed disabling the input so the user can type the next question while waiting for the response
        // messageInput.disabled = true;
        sendButton.style.display = 'none';
        stopButton.style.display = 'block';
        controller = new AbortController();

        let botMessageElement = appendMessage('bot', '<span class="typing-indicator"></span>', true);
        const botContentDiv = botMessageElement.querySelector('div');
        
        let fullResponse = '';

        try {
            const previous_response_id = localStorage.getItem(RESPONSE_ID_KEY);
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message, previous_response_id }),
                signal: controller.signal
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Server returned a non-JSON error' }));
                throw new Error(errorData.error || 'Failed to get response from server');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { value, done } = await reader.read();
                if (done) {
                    // Process any remaining data in the buffer
                    if (buffer.trim()) {
                        console.warn("Stream ended with unprocessed data in buffer:", buffer);
                    }
                    break;
                }

                // Add the new chunk to the buffer
                buffer += decoder.decode(value, { stream: true });

                // Process all complete messages (ending with '\n\n') in the buffer
                let boundary;
                while ((boundary = buffer.indexOf('\n\n')) !== -1) {
                    const messageString = buffer.substring(0, boundary);
                    buffer = buffer.substring(boundary + 2); // Move past the message and the delimiter

                    if (!messageString.startsWith('data:')) {
                        continue;
                    }

                    const jsonData = messageString.substring(5); // Remove "data:" prefix
                    if (!jsonData.trim()) {
                        continue;
                    }

                    // Check if user is scrolled to the bottom BEFORE adding new content.
                    const scrollBuffer = 20;
                    const isScrolledToBottom = chatWindow.scrollHeight - chatWindow.clientHeight <= chatWindow.scrollTop + scrollBuffer;

                    try {
                        const eventData = JSON.parse(jsonData);

                        if (eventData.type === 'response.output_text.delta') {
                            fullResponse += eventData.delta;
                            botContentDiv.innerHTML = formatToHtml(fullResponse);

                            if (isScrolledToBottom) {
                                chatWindow.scrollTop = chatWindow.scrollHeight;
                            }
                        } else if (eventData.type === 'response.completed') {
                            localStorage.setItem(RESPONSE_ID_KEY, eventData.response.id);
                            if (isScrolledToBottom) {
                                chatWindow.scrollTop = chatWindow.scrollHeight;
                            }
                            return; // End processing once the response is complete
                        } else if (eventData.type === 'response.failed') {
                            throw new Error(eventData.response.error.message || 'Response stream failed');
                        }
                    } catch (error) {
                        console.error('Failed to parse JSON from stream:', error);
                        // Let the main catch block handle the UI update for the error
                        throw new Error('Error processing server response.');
                    }
                }
            }
        } catch (error) {
            if (error.name !== 'AbortError') {
                const errorMessage = `Error: ${error.message}`;
                if (botContentDiv) {
                    botContentDiv.innerHTML = `<p style="color:red;">${errorMessage}</p>`;
                } else {
                    appendMessage('bot', `<p style="color:red;">${errorMessage}</p>`, true);
                }
            }
        } finally {
            // messageInput.disabled = false; // This line is removed as per the edit hint
            sendButton.style.display = 'block';
            stopButton.style.display = 'none';
            messageInput.focus();
            controller = null;
        }
    });

    stopButton.addEventListener('click', () => {
        if (controller) {
            controller.abort();
            appendMessage('system', 'Respuesta detenida por el usuario.');
        }
    });

    // Add a simple style for the typing indicator
    const style = document.createElement('style');
    style.textContent = `
    .typing-indicator {
        display: inline-block;
        width: 8px;
        height: 8px;
        background-color: currentColor;
        border-radius: 50%;
        animation: typing-blink 1.4s infinite both;
    }
    .typing-indicator::before, .typing-indicator::after {
        content: '';
        display: inline-block;
        width: 8px;
        height: 8px;
        background-color: currentColor;
        border-radius: 50%;
        position: absolute;
    }
    .typing-indicator::before {
        left: -12px;
        animation: typing-blink 1.4s infinite both 0.2s;
    }
    .typing-indicator::after {
        left: 12px;
        animation: typing-blink 1.4s infinite both 0.4s;
    }
    @keyframes typing-blink {
        0% { opacity: 0.2; }
        20% { opacity: 1; }
        100% { opacity: 0.2; }
    }
    `;
    document.head.appendChild(style);
}); 