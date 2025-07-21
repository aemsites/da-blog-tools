// DA Chat - Configurable AI Chatbot with MCP Support
class DAChat {
    constructor() {
        this.models = [];
        this.mcpServers = [];
        this.currentModel = null;
        this.chatHistory = [];
        this.isLoading = false;
        
        this.init();
    }

    init() {
        this.loadConfiguration();
        this.setupEventListeners();
        this.updateModelDropdown();
        this.updateModelsList();
        this.updateMcpServersList();
    }

    // Configuration Management
    loadConfiguration() {
        const savedConfig = localStorage.getItem('da-chat-config');
        if (savedConfig) {
            const config = JSON.parse(savedConfig);
            this.models = config.models || [];
            this.mcpServers = config.mcpServers || [];
        } else {
            // Default configuration
            this.models = [
                {
                    id: 'gpt-4',
                    name: 'GPT-4',
                    type: 'openai',
                    apiKey: '',
                    apiEndpoint: 'https://api.openai.com/v1',
                    modelIdentifier: 'gpt-4',
                    maxTokens: 4096,
                    temperature: 0.7
                },
                {
                    id: 'claude-3',
                    name: 'Claude 3 Sonnet',
                    type: 'anthropic',
                    apiKey: '',
                    apiEndpoint: 'https://api.anthropic.com',
                    modelIdentifier: 'claude-3-sonnet-20240229',
                    maxTokens: 4096,
                    temperature: 0.7
                }
            ];
            this.mcpServers = [
                {
                    id: 'filesystem',
                    name: 'File System',
                    url: 'http://localhost:3000/mcp/filesystem',
                    auth: '',
                    description: 'Access to local file system'
                },
                {
                    id: 'github',
                    name: 'GitHub',
                    url: 'http://localhost:3000/mcp/github',
                    auth: '',
                    description: 'GitHub repository access'
                }
            ];
        }
    }

    saveConfiguration() {
        const config = {
            models: this.models,
            mcpServers: this.mcpServers
        };
        localStorage.setItem('da-chat-config', JSON.stringify(config));
    }

    // UI Updates
    updateModelDropdown() {
        const select = document.getElementById('modelSelect');
        select.innerHTML = '<option value="">Select Model...</option>';
        
        this.models.forEach(model => {
            const option = document.createElement('option');
            option.value = model.id;
            option.textContent = model.name;
            select.appendChild(option);
        });
    }

    updateModelsList() {
        const list = document.getElementById('modelsList');
        list.innerHTML = '';
        
        this.models.forEach(model => {
            const item = document.createElement('div');
            item.className = 'model-item';
            item.innerHTML = `
                <div class="model-item-info">
                    <div class="model-item-name">${model.name}</div>
                    <div class="model-item-type">${model.type} - ${model.modelIdentifier}</div>
                </div>
                <button class="delete-btn" onclick="daChat.deleteModel('${model.id}')">Delete</button>
            `;
            list.appendChild(item);
        });
    }

    updateMcpServersList() {
        const list = document.getElementById('mcpServersList');
        list.innerHTML = '';
        
        this.mcpServers.forEach(server => {
            const item = document.createElement('div');
            item.className = 'mcp-server-item';
            item.innerHTML = `
                <div class="mcp-server-info">
                    <div class="mcp-server-name">${server.name}</div>
                    <div class="mcp-server-url">${server.url}</div>
                </div>
                <button class="delete-btn" onclick="daChat.deleteMcpServer('${server.id}')">Delete</button>
            `;
            list.appendChild(item);
        });
    }

    // Event Listeners
    setupEventListeners() {
        // Model selection
        document.getElementById('modelSelect').addEventListener('change', (e) => {
            this.selectModel(e.target.value);
        });

        // Send message
        document.getElementById('sendBtn').addEventListener('click', () => {
            this.sendMessage();
        });

        // Enter key in input
        document.getElementById('messageInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // Auto-resize textarea
        document.getElementById('messageInput').addEventListener('input', (e) => {
            e.target.style.height = 'auto';
            e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
            this.updateSendButton();
        });

        // Configuration modal
        document.getElementById('configBtn').addEventListener('click', () => {
            this.showConfigModal();
        });

        document.getElementById('closeModal').addEventListener('click', () => {
            this.hideConfigModal();
        });

        document.getElementById('saveConfig').addEventListener('click', () => {
            this.saveConfiguration();
            this.hideConfigModal();
        });

        document.getElementById('cancelConfig').addEventListener('click', () => {
            this.hideConfigModal();
        });

        // Model form
        document.getElementById('addModelBtn').addEventListener('click', () => {
            this.showModelForm();
        });

        document.getElementById('saveModel').addEventListener('click', () => {
            this.saveModel();
        });

        document.getElementById('cancelModel').addEventListener('click', () => {
            this.hideModelForm();
        });

        document.getElementById('closeModelForm').addEventListener('click', () => {
            this.hideModelForm();
        });

        // MCP Server form
        document.getElementById('addMcpServerBtn').addEventListener('click', () => {
            this.showMcpForm();
        });

        document.getElementById('saveMcp').addEventListener('click', () => {
            this.saveMcpServer();
        });

        document.getElementById('cancelMcp').addEventListener('click', () => {
            this.hideMcpForm();
        });

        document.getElementById('closeMcpForm').addEventListener('click', () => {
            this.hideMcpForm();
        });

        // Temperature range
        document.getElementById('temperature').addEventListener('input', (e) => {
            document.getElementById('temperatureValue').textContent = e.target.value;
        });

        // Modal backdrop clicks
        document.getElementById('configModal').addEventListener('click', (e) => {
            if (e.target.id === 'configModal') {
                this.hideConfigModal();
            }
        });

        document.getElementById('modelFormModal').addEventListener('click', (e) => {
            if (e.target.id === 'modelFormModal') {
                this.hideModelForm();
            }
        });

        document.getElementById('mcpFormModal').addEventListener('click', (e) => {
            if (e.target.id === 'mcpFormModal') {
                this.hideMcpForm();
            }
        });
    }

    // Model Management
    selectModel(modelId) {
        this.currentModel = this.models.find(m => m.id === modelId);
        this.updateSendButton();
        
        if (this.currentModel) {
            this.addMessage('assistant', `Connected to ${this.currentModel.name}. Ready to chat!`);
        }
    }

    addModel(modelData) {
        const model = {
            id: this.generateId(),
            ...modelData
        };
        this.models.push(model);
        this.updateModelDropdown();
        this.updateModelsList();
        this.saveConfiguration();
    }

    deleteModel(modelId) {
        this.models = this.models.filter(m => m.id !== modelId);
        if (this.currentModel?.id === modelId) {
            this.currentModel = null;
            document.getElementById('modelSelect').value = '';
        }
        this.updateModelDropdown();
        this.updateModelsList();
        this.updateSendButton();
        this.saveConfiguration();
    }

    // MCP Server Management
    addMcpServer(serverData) {
        const server = {
            id: this.generateId(),
            ...serverData
        };
        this.mcpServers.push(server);
        this.updateMcpServersList();
        this.saveConfiguration();
    }

    deleteMcpServer(serverId) {
        this.mcpServers = this.mcpServers.filter(s => s.id !== serverId);
        this.updateMcpServersList();
        this.saveConfiguration();
    }

    // Chat Functionality
    async sendMessage() {
        const input = document.getElementById('messageInput');
        const message = input.value.trim();
        
        if (!message || !this.currentModel || this.isLoading) {
            return;
        }

        // Add user message
        this.addMessage('user', message);
        input.value = '';
        input.style.height = 'auto';
        this.updateSendButton();

        // Show loading
        this.isLoading = true;
        this.updateSendButton();
        const loadingMessage = this.addMessage('assistant', '', true);

        try {
            // Prepare context with MCP servers
            const context = await this.prepareContext();
            
            // Send to model
            const response = await this.callModel(message, context);
            
            // Update loading message with response
            this.updateMessage(loadingMessage, response);
        } catch (error) {
            console.error('Error sending message:', error);
            this.updateMessage(loadingMessage, `Error: ${error.message}`);
        } finally {
            this.isLoading = false;
            this.updateSendButton();
        }
    }

    async prepareContext() {
        const context = {
            messages: this.chatHistory,
            mcpServers: this.mcpServers
        };

        // If we have MCP servers, try to get additional context
        if (this.mcpServers.length > 0) {
            try {
                const mcpContext = await this.getMcpContext();
                context.mcpData = mcpContext;
            } catch (error) {
                console.warn('Failed to get MCP context:', error);
            }
        }

        return context;
    }

    async getMcpContext() {
        const context = {};
        
        for (const server of this.mcpServers) {
            try {
                const response = await fetch(server.url + '/context', {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(server.auth && { 'Authorization': server.auth })
                    }
                });
                
                if (response.ok) {
                    context[server.id] = await response.json();
                }
            } catch (error) {
                console.warn(`Failed to get context from ${server.name}:`, error);
            }
        }
        
        return context;
    }

    async callModel(message, context) {
        const model = this.currentModel;
        
        switch (model.type) {
            case 'openai':
                return await this.callOpenAI(message, context, model);
            case 'anthropic':
                return await this.callAnthropic(message, context, model);
            case 'local':
                return await this.callLocalModel(message, context, model);
            case 'custom':
                return await this.callCustomAPI(message, context, model);
            default:
                throw new Error(`Unsupported model type: ${model.type}`);
        }
    }

    async callOpenAI(message, context, model) {
        const response = await fetch(`${model.apiEndpoint}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${model.apiKey}`
            },
            body: JSON.stringify({
                model: model.modelIdentifier,
                messages: [
                    ...this.chatHistory.map(msg => ({
                        role: msg.role,
                        content: msg.content
                    })),
                    { role: 'user', content: message }
                ],
                max_tokens: model.maxTokens,
                temperature: model.temperature
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || `HTTP ${response.status}`);
        }

        const data = await response.json();
        return data.choices[0].message.content;
    }

    async callAnthropic(message, context, model) {
        const response = await fetch(`${model.apiEndpoint}/v1/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': model.apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: model.modelIdentifier,
                max_tokens: model.maxTokens,
                temperature: model.temperature,
                messages: [
                    ...this.chatHistory.map(msg => ({
                        role: msg.role,
                        content: msg.content
                    })),
                    { role: 'user', content: message }
                ]
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || `HTTP ${response.status}`);
        }

        const data = await response.json();
        return data.content[0].text;
    }

    async callLocalModel(message, context, model) {
        const response = await fetch(model.apiEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(model.apiKey && { 'Authorization': `Bearer ${model.apiKey}` })
            },
            body: JSON.stringify({
                message,
                context,
                model: model.modelIdentifier,
                max_tokens: model.maxTokens,
                temperature: model.temperature
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || `HTTP ${response.status}`);
        }

        const data = await response.json();
        return data.response || data.message || data.content;
    }

    async callCustomAPI(message, context, model) {
        const response = await fetch(model.apiEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(model.apiKey && { 'Authorization': `Bearer ${model.apiKey}` })
            },
            body: JSON.stringify({
                message,
                context,
                model: model.modelIdentifier,
                max_tokens: model.maxTokens,
                temperature: model.temperature
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || `HTTP ${response.status}`);
        }

        const data = await response.json();
        return data.response || data.message || data.content;
    }

    // UI Helpers
    addMessage(role, content, isLoading = false) {
        const messagesContainer = document.getElementById('chatMessages');
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${role}`;
        
        const avatar = document.createElement('div');
        avatar.className = 'message-avatar';
        avatar.textContent = role === 'user' ? 'U' : 'A';
        
        const messageContent = document.createElement('div');
        messageContent.className = 'message-content';
        
        if (isLoading) {
            messageContent.innerHTML = `
                <div class="loading">
                    <div class="loading-spinner"></div>
                    <span>Thinking...</span>
                </div>
            `;
        } else {
            messageContent.textContent = content;
        }
        
        const timeDiv = document.createElement('div');
        timeDiv.className = 'message-time';
        timeDiv.textContent = new Date().toLocaleTimeString();
        
        messageDiv.appendChild(avatar);
        messageDiv.appendChild(messageContent);
        messageDiv.appendChild(timeDiv);
        
        messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        
        // Add to chat history
        if (!isLoading) {
            this.chatHistory.push({ role, content, timestamp: new Date() });
        }
        
        return messageDiv;
    }

    updateMessage(messageDiv, content) {
        const contentDiv = messageDiv.querySelector('.message-content');
        contentDiv.innerHTML = '';
        contentDiv.textContent = content;
        
        // Update chat history
        const lastMessage = this.chatHistory[this.chatHistory.length - 1];
        if (lastMessage && lastMessage.role === 'assistant') {
            lastMessage.content = content;
        }
    }

    updateSendButton() {
        const input = document.getElementById('messageInput');
        const sendBtn = document.getElementById('sendBtn');
        const hasText = input.value.trim().length > 0;
        const hasModel = this.currentModel !== null;
        const notLoading = !this.isLoading;
        
        sendBtn.disabled = !(hasText && hasModel && notLoading);
    }

    // Modal Management
    showConfigModal() {
        document.getElementById('configModal').classList.add('show');
    }

    hideConfigModal() {
        document.getElementById('configModal').classList.remove('show');
    }

    showModelForm() {
        document.getElementById('modelFormTitle').textContent = 'Add Model';
        document.getElementById('modelForm').reset();
        document.getElementById('modelFormModal').classList.add('show');
    }

    hideModelForm() {
        document.getElementById('modelFormModal').classList.remove('show');
    }

    showMcpForm() {
        document.getElementById('mcpFormTitle').textContent = 'Add MCP Server';
        document.getElementById('mcpForm').reset();
        document.getElementById('mcpFormModal').classList.add('show');
    }

    hideMcpForm() {
        document.getElementById('mcpFormModal').classList.remove('show');
    }

    // Form Handlers
    saveModel() {
        const form = document.getElementById('modelForm');
        const formData = new FormData(form);
        
        const modelData = {
            name: formData.get('modelName') || document.getElementById('modelName').value,
            type: formData.get('modelType') || document.getElementById('modelType').value,
            apiKey: formData.get('apiKey') || document.getElementById('apiKey').value,
            apiEndpoint: formData.get('apiEndpoint') || document.getElementById('apiEndpoint').value,
            modelIdentifier: formData.get('modelIdentifier') || document.getElementById('modelIdentifier').value,
            maxTokens: parseInt(formData.get('maxTokens') || document.getElementById('maxTokens').value),
            temperature: parseFloat(formData.get('temperature') || document.getElementById('temperature').value)
        };
        
        if (!modelData.name || !modelData.type || !modelData.apiKey) {
            alert('Please fill in all required fields');
            return;
        }
        
        this.addModel(modelData);
        this.hideModelForm();
    }

    saveMcpServer() {
        const form = document.getElementById('mcpForm');
        const formData = new FormData(form);
        
        const serverData = {
            name: formData.get('mcpName') || document.getElementById('mcpName').value,
            url: formData.get('mcpUrl') || document.getElementById('mcpUrl').value,
            auth: formData.get('mcpAuth') || document.getElementById('mcpAuth').value,
            description: formData.get('mcpDescription') || document.getElementById('mcpDescription').value
        };
        
        if (!serverData.name || !serverData.url) {
            alert('Please fill in all required fields');
            return;
        }
        
        this.addMcpServer(serverData);
        this.hideMcpForm();
    }

    // Utility Functions
    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }
}

// Initialize the chat when the page loads
let daChat;
document.addEventListener('DOMContentLoaded', () => {
    daChat = new DAChat();
});

// Make daChat globally available for button onclick handlers
window.daChat = daChat;
