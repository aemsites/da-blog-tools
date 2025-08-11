class HLXChat {
    constructor() {
        this.messages = [];
        this.messageInput = document.getElementById('messageInput');
        this.sendButton = document.getElementById('sendButton');
        this.chatMessages = document.getElementById('chatMessages');
        this.typingIndicator = document.getElementById('typingIndicator');
        
        this.initializeEventListeners();
        this.loadSidekickInfo();
    }
    
    initializeEventListeners() {
        this.sendButton.addEventListener('click', () => this.sendMessage());
        this.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendMessage();
            }
        });
    }
    
    async loadSidekickInfo() {
        try {
            // Try to get sidekick configuration from URL parameters
            const urlParams = new URLSearchParams(window.location.search);
            const config = urlParams.get('config');
            const referrer = urlParams.get('referrer');
            
            if (config) {
                console.log('Sidekick config received:', config);
            }
            
            if (referrer) {
                console.log('Referrer URL:', referrer);
                this.addMessage('bot', `Connected from: ${referrer}`);
            }
        } catch (error) {
            console.error('Error loading sidekick info:', error);
        }
    }
    
    sendMessage() {
        const message = this.messageInput.value.trim();
        if (!message) return;
        
        // Add user message
        this.addMessage('user', message);
        this.messageInput.value = '';
        
        // Show typing indicator
        this.showTypingIndicator();
        
        // Simulate AI response
        setTimeout(() => {
            this.hideTypingIndicator();
            this.generateResponse(message);
        }, 1000 + Math.random() * 2000);
    }
    
    addMessage(type, content) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        messageDiv.innerHTML = `
            <div class="message-content">
                ${this.escapeHtml(content)}
            </div>
        `;
        
        this.chatMessages.appendChild(messageDiv);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
        
        this.messages.push({ type, content, timestamp: new Date() });
    }
    
    generateResponse(userMessage) {
        const responses = [
            "That's an interesting question! Let me help you with that.",
            "I understand what you're asking. Here's what I can tell you...",
            "Great question! Based on the AEM documentation, here's what I found...",
            "I'm here to help with your AEM questions. Let me break this down...",
            "Thanks for asking! This is a common question about AEM development."
        ];
        
        const randomResponse = responses[Math.floor(Math.random() * responses.length)];
        this.addMessage('bot', randomResponse);
    }
    
    showTypingIndicator() {
        this.typingIndicator.classList.add('show');
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }
    
    hideTypingIndicator() {
        this.typingIndicator.classList.remove('show');
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize chat when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new HLXChat();
});

// Listen for sidekick events if available
if (window.parent && window.parent !== window) {
    try {
        window.parent.postMessage({
            type: 'hlx-chat-ready',
            source: 'hlx-chat-plugin'
        }, '*');
    } catch (error) {
        console.log('Could not send message to parent window');
    }
}
