// DA Chat - Configurable AI Chatbot with MCP Support
class DAChat {
    constructor() {
        this.models = [];
        this.mcpServers = [];
        this.currentModel = null;
        this.chatHistory = [];
        this.isLoading = false;
        this.editingModelId = null;
        this.editingServerId = null;
        
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
                    id: 'azure-gpt-4',
                    name: 'Azure GPT-4',
                    type: 'openai',
                    apiKey: '',
                    apiEndpoint: 'https://your-resource.openai.azure.com',
                    modelIdentifier: 'your-deployment-name',
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
                    url: 'http://localhost:3001',
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
                <div class="model-item-actions">
                    <button class="edit-btn" data-model-id="${model.id}">Edit</button>
                    <button class="delete-btn" data-model-id="${model.id}">Delete</button>
                </div>
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
                <div class="mcp-server-actions">
                    <button class="edit-btn" data-server-id="${server.id}">Edit</button>
                    <button class="delete-btn" data-server-id="${server.id}">Delete</button>
                </div>
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

        // Event delegation for delete and edit buttons
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('delete-btn')) {
                if (e.target.hasAttribute('data-model-id')) {
                    const modelId = e.target.getAttribute('data-model-id');
                    this.deleteModel(modelId);
                } else if (e.target.hasAttribute('data-server-id')) {
                    const serverId = e.target.getAttribute('data-server-id');
                    this.deleteMcpServer(serverId);
                }
            } else if (e.target.classList.contains('edit-btn')) {
                if (e.target.hasAttribute('data-model-id')) {
                    const modelId = e.target.getAttribute('data-model-id');
                    this.editModel(modelId);
                } else if (e.target.hasAttribute('data-server-id')) {
                    const serverId = e.target.getAttribute('data-server-id');
                    this.editMcpServer(serverId);
                }
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

    editModel(modelId) {
        const model = this.models.find(m => m.id === modelId);
        if (!model) return;
        
        this.editingModelId = modelId;
        this.populateModelForm(model);
        this.showModelForm();
    }

    editMcpServer(serverId) {
        const server = this.mcpServers.find(s => s.id === serverId);
        if (!server) return;
        
        this.editingServerId = serverId;
        this.populateMcpForm(server);
        this.showMcpForm();
    }

    populateModelForm(model) {
        document.getElementById('modelName').value = model.name;
        document.getElementById('modelType').value = model.type;
        document.getElementById('apiKey').value = model.apiKey;
        document.getElementById('apiEndpoint').value = model.apiEndpoint || '';
        document.getElementById('modelIdentifier').value = model.modelIdentifier || '';
        document.getElementById('maxTokens').value = model.maxTokens || 4096;
        document.getElementById('temperature').value = model.temperature || 0.7;
        document.getElementById('temperatureValue').textContent = model.temperature || 0.7;
    }

    populateMcpForm(server) {
        document.getElementById('mcpName').value = server.name;
        document.getElementById('mcpUrl').value = server.url;
        document.getElementById('mcpAuth').value = server.auth || '';
        document.getElementById('mcpDescription').value = server.description || '';
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
                // Get context
                const contextResponse = await fetch(server.url + '/context', {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(server.auth && { 'Authorization': server.auth })
                    }
                });
                
                if (contextResponse.ok) {
                    context[server.id] = await contextResponse.json();
                }

                // Get available tools
                const toolsResponse = await fetch(server.url + '/tools', {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(server.auth && { 'Authorization': server.auth })
                    }
                });
                
                if (toolsResponse.ok) {
                    const toolsData = await toolsResponse.json();
                    context[`${server.id}_tools`] = toolsData;
                }
            } catch (error) {
                console.warn(`Failed to get context from ${server.name}:`, error);
            }
        }
        
        return context;
    }

    async executeMcpTool(serverId, tool, params) {
        const server = this.mcpServers.find(s => s.id === serverId);
        if (!server) {
            throw new Error(`MCP server ${serverId} not found`);
        }

        const response = await fetch(server.url + '/tools', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(server.auth && { 'Authorization': server.auth })
            },
            body: JSON.stringify({ tool, params })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || `HTTP ${response.status}`);
        }

        const data = await response.json();
        return data.result;
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
        // Check if this is an Azure OpenAI endpoint
        const isAzure = model.apiEndpoint.includes('azure.com') || model.apiEndpoint.includes('openai.azure.com');
        
        let endpoint, headers;
        
        if (isAzure) {
            // Azure OpenAI format: https://{resource-name}.openai.azure.com/openai/deployments/{deployment-name}/chat/completions?api-version=2024-02-15-preview
            const deploymentName = model.modelIdentifier; // In Azure, modelIdentifier should be the deployment name
            endpoint = `${model.apiEndpoint}/openai/deployments/${deploymentName}/chat/completions?api-version=2024-02-15-preview`;
            headers = {
                'Content-Type': 'application/json',
                'api-key': model.apiKey // Azure uses api-key header instead of Authorization
            };
        } else {
            // Standard OpenAI format
            endpoint = `${model.apiEndpoint}/chat/completions`;
            headers = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${model.apiKey}`
            };
        }

        // Prepare system message with MCP context
        let systemMessage = "You are a helpful AI assistant.";
        
        if (context.mcpServers && context.mcpServers.length > 0) {
            systemMessage += "\n\nYou have access to the following MCP (Model Context Protocol) servers:\n";
            
            context.mcpServers.forEach(server => {
                systemMessage += `- ${server.name}: ${server.description || 'No description'}\n`;
            });
            
            if (context.mcpData) {
                systemMessage += "\nCurrent MCP context:\n";
                Object.keys(context.mcpData).forEach(serverId => {
                    const data = context.mcpData[serverId];
                    if (data && typeof data === 'object') {
                        systemMessage += `\n${serverId} server data: ${JSON.stringify(data, null, 2)}\n`;
                    }
                });
            }
            
            systemMessage += "\nWhen users ask about files, directories, or system information, use the MCP server data to provide accurate responses. You can access file system information through the configured MCP servers.";
        }

        const response = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                messages: [
                    { role: 'system', content: systemMessage },
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
            let errorMessage = `HTTP ${response.status}`;
            try {
                const error = await response.json();
                errorMessage = error.error?.message || error.message || errorMessage;
            } catch (e) {
                // If error response is not JSON, use status text
                errorMessage = response.statusText || errorMessage;
            }
            throw new Error(errorMessage);
        }

        const data = await response.json();
        return data.choices[0].message.content;
    }

    async callAnthropic(message, context, model) {
        // Prepare system message with MCP context
        let systemMessage = "You are a helpful AI assistant.";
        
        if (context.mcpServers && context.mcpServers.length > 0) {
            systemMessage += "\n\nYou have access to the following MCP (Model Context Protocol) servers:\n";
            
            context.mcpServers.forEach(server => {
                systemMessage += `- ${server.name}: ${server.description || 'No description'}\n`;
            });
            
            if (context.mcpData) {
                systemMessage += "\nCurrent MCP context:\n";
                Object.keys(context.mcpData).forEach(serverId => {
                    const data = context.mcpData[serverId];
                    if (data && typeof data === 'object') {
                        systemMessage += `\n${serverId} server data: ${JSON.stringify(data, null, 2)}\n`;
                    }
                });
            }
            
            systemMessage += "\nWhen users ask about files, directories, or system information, use the MCP server data to provide accurate responses. You can access file system information through the configured MCP servers.";
        }

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
                system: systemMessage,
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
        contentDiv.innerHTML = this.formatMessage(content);
        
        // Update chat history
        const lastMessage = this.chatHistory[this.chatHistory.length - 1];
        if (lastMessage && lastMessage.role === 'assistant') {
            lastMessage.content = content;
        }
    }

    formatMessage(content) {
        if (!content) return '';
        
        // Convert markdown to HTML
        let formatted = content
            // Code blocks
            .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>')
            // Inline code
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            // Bold
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            // Italic
            .replace(/\*([^*]+)\*/g, '<em>$1</em>')
            // Headers
            .replace(/^### (.*$)/gm, '<h3>$1</h3>')
            .replace(/^## (.*$)/gm, '<h2>$1</h2>')
            .replace(/^# (.*$)/gm, '<h1>$1</h1>')
            // Lists
            .replace(/^\* (.*$)/gm, '<li>$1</li>')
            .replace(/^- (.*$)/gm, '<li>$1</li>')
            // Wrap lists in ul tags
            .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
            // Line breaks
            .replace(/\n/g, '<br>')
            // Links
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
        
        // Format file listings and JSON data
        formatted = this.formatFileListings(formatted);
        
        return formatted;
    }

    formatFileListings(content) {
        // Format JSON-like file listings
        return content.replace(/\{[\s\S]*?\}/g, (match) => {
            try {
                const data = JSON.parse(match);
                if (data && typeof data === 'object') {
                    return `<div class="json-data">${JSON.stringify(data, null, 2)}</div>`;
                }
            } catch (e) {
                // Not valid JSON, return as is
            }
            return match;
        });
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
        const isEditing = this.editingModelId !== null;
        document.getElementById('modelFormTitle').textContent = isEditing ? 'Edit Model' : 'Add Model';
        if (!isEditing) {
            document.getElementById('modelForm').reset();
        }
        document.getElementById('modelFormModal').classList.add('show');
    }

    hideModelForm() {
        document.getElementById('modelFormModal').classList.remove('show');
        this.editingModelId = null;
    }

    showMcpForm() {
        const isEditing = this.editingServerId !== null;
        document.getElementById('mcpFormTitle').textContent = isEditing ? 'Edit MCP Server' : 'Add MCP Server';
        if (!isEditing) {
            document.getElementById('mcpForm').reset();
        }
        document.getElementById('mcpFormModal').classList.add('show');
    }

    hideMcpForm() {
        document.getElementById('mcpFormModal').classList.remove('show');
        this.editingServerId = null;
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
        
        if (this.editingModelId) {
            // Update existing model
            const modelIndex = this.models.findIndex(m => m.id === this.editingModelId);
            if (modelIndex !== -1) {
                this.models[modelIndex] = { ...this.models[modelIndex], ...modelData };
                this.updateModelDropdown();
                this.updateModelsList();
                this.saveConfiguration();
            }
        } else {
            // Add new model
            this.addModel(modelData);
        }
        
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
        
        if (this.editingServerId) {
            // Update existing server
            const serverIndex = this.mcpServers.findIndex(s => s.id === this.editingServerId);
            if (serverIndex !== -1) {
                this.mcpServers[serverIndex] = { ...this.mcpServers[serverIndex], ...serverData };
                this.updateMcpServersList();
                this.saveConfiguration();
            }
        } else {
            // Add new server
            this.addMcpServer(serverData);
        }
        
        this.hideMcpForm();
    }

    // Utility Functions
    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }
}

// Initialize the chat when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new DAChat();
});
