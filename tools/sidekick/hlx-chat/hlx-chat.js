class HLXChat {
    constructor() {
        this.messages = [];
        this.messageInput = document.getElementById('messageInput');
        this.sendButton = document.getElementById('sendButton');
        this.chatMessages = document.getElementById('chatMessages');
        this.typingIndicator = document.getElementById('typingIndicator');
        
        this.initializeEventListeners();
        this.loadSidekickInfo();
        this.adjustToParentContainer();
    }
    
    initializeEventListeners() {
        this.sendButton.addEventListener('click', () => this.sendMessage());
        this.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendMessage();
            }
        });
        
        // Handle window resize for responsive behavior
        window.addEventListener('resize', () => this.adjustToParentContainer());
    }
    
    adjustToParentContainer() {
        // Ensure the chat container fills the available space
        const container = document.querySelector('.chat-container');
        if (container) {
            container.style.width = '100%';
            container.style.height = '100vh';
        }
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
            
            // Add a welcome message about the integrated mode
            this.addMessage('bot', 'Chat interface is now integrated into the parent container. You can use the full available space for better interaction.');
            
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
            "Thanks for asking! This is a common question about AEM development.",
            "Since we're now integrated into the parent container, I have more space to provide detailed responses.",
            "The integrated chat interface gives us better visibility and interaction capabilities."
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
            source: 'hlx-chat-plugin',
            mode: 'integrated'
        }, '*');
    } catch (error) {
        console.log('Could not send message to parent window');
    }
}
