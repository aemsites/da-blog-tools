import DA_SDK from 'https://da.live/nx/utils/sdk.js';

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
        this.stdioConnections = new Map(); // Store stdio MCP connections
        this.daToken = null; // Store DA SDK token
        
        this.init();
    }

    async init() {
        this.loadConfiguration();
        this.setupEventListeners();
        this.updateModelDropdown();
        this.updateModelsList();
        this.updateMcpServersList();
        
        // Auto-select the first model if only one is configured
        if (this.models.length === 1 && !this.currentModel) {
            this.selectModel(this.models[0].id);
        }
        
        // Initialize DA SDK
        try {
            const { context, token, actions } = await DA_SDK;
            console.log('DA SDK initialized:', { context, token, actions });
            
            // Set the DA token for MCP servers
            this.setDaTokenForMcpServers(token);
        } catch (error) {
            console.error('Failed to initialize DA SDK:', error);
        }
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
                    transport: 'http',
                    url: 'http://localhost:3001',
                    auth: '',
                    description: 'Access to local file system'
                },
                {
                    id: 'helix-mcp',
                    name: 'Helix MCP',
                    transport: 'stdio',
                    command: 'https://github.com/cloudadoption/helix-mcp',
                    auth: '',
                    env: {
                        HELIX_ADMIN_API_TOKEN: ''
                    },
                    description: 'Helix and Document Authoring Admin API access (DA_ADMIN_API_TOKEN and HELIX_ADMIN_API_TOKEN will be auto-set from SDK)'
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
            
            const transport = server.transport || 'http';
            const endpoint = transport === 'http' ? server.url : server.command;
            
            item.innerHTML = `
                <div class="mcp-server-info">
                    <div class="mcp-server-name">${server.name}</div>
                    <div class="mcp-server-url">
                        <span class="transport-badge ${transport}">${transport.toUpperCase()}</span>
                        ${endpoint}
                    </div>
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

        // Transport type switching
        document.getElementById('mcpTransport').addEventListener('change', (e) => {
            const transport = e.target.value;
            const httpFields = document.getElementById('httpFields');
            const stdioFields = document.getElementById('stdioFields');
            const envFields = document.getElementById('envFields');
            
            if (transport === 'http') {
                httpFields.style.display = 'block';
                stdioFields.style.display = 'none';
                envFields.style.display = 'none';
                document.getElementById('mcpUrl').required = true;
                document.getElementById('mcpCommand').required = false;
                document.getElementById('mcpEnv').required = false;
            } else {
                httpFields.style.display = 'none';
                stdioFields.style.display = 'block';
                envFields.style.display = 'block';
                document.getElementById('mcpUrl').required = false;
                document.getElementById('mcpCommand').required = true;
                document.getElementById('mcpEnv').required = false; // Optional but recommended
            }
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
        document.getElementById('mcpTransport').value = server.transport || 'http';
        document.getElementById('mcpAuth').value = server.auth || '';
        document.getElementById('mcpDescription').value = server.description || '';
        
        // Trigger transport change to show/hide fields
        const transportEvent = new Event('change');
        document.getElementById('mcpTransport').dispatchEvent(transportEvent);
        
        if (server.transport === 'http') {
            document.getElementById('mcpUrl').value = server.url || '';
        } else {
            document.getElementById('mcpCommand').value = server.command || server.url || '';
            if (server.env) {
                document.getElementById('mcpEnv').value = JSON.stringify(server.env, null, 2);
            }
        }
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
            
            console.log('AI Response before tool processing:', response);
            
            // Check if response contains tool execution requests
            const finalResponse = await this.processToolExecutions(response);
            
            console.log('Final response after tool processing:', finalResponse);
            
            // Update loading message with response
            this.updateMessage(loadingMessage, finalResponse);
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
        console.log('Getting MCP context for servers:', this.mcpServers.map(s => s.name));
        
        for (const server of this.mcpServers) {
            try {
                console.log(`Processing server: ${server.name} (${server.transport})`);
                if (server.transport === 'stdio') {
                    // Handle stdio transport
                    const stdioContext = await this.getStdioMcpContext(server);
                    if (stdioContext) {
                        context[server.id] = stdioContext;
                        console.log(`Added stdio context for ${server.name}:`, stdioContext);
                    }
                } else {
                    // Handle HTTP transport
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
                }
            } catch (error) {
                console.warn(`Failed to get context from ${server.name}:`, error);
            }
        }
        
        console.log('Final MCP context:', context);
        return context;
    }

    async getStdioMcpContext(server) {
        try {
            console.log(`Getting stdio context for ${server.name}...`);
            const connection = await this.getStdioConnection(server);
            if (!connection) {
                console.warn(`No stdio connection available for ${server.name}. Skipping stdio context.`);
                return {
                    server: server.name,
                    transport: 'stdio',
                    status: 'unavailable',
                    error: 'Stdio MCP server not running'
                };
            }

            console.log(`Calling tools/list for ${server.name}...`);
            // Get server info and tools
            const tools = await this.callStdioMethod(connection, 'tools/list', {});
            console.log(`Tools response for ${server.name}:`, tools);
            
            const result = {
                server: server.name,
                transport: 'stdio',
                tools: tools?.tools || tools?.result || [],
                resources: [], // Helix MCP doesn't support resources/list
                status: 'connected'
            };
            
            console.log(`Final context for ${server.name}:`, result);
            return result;
        } catch (error) {
            console.error(`Failed to get stdio context from ${server.name}:`, error);
            return {
                server: server.name,
                transport: 'stdio',
                status: 'error',
                error: error.message
            };
        }
    }

    async getStdioConnection(server) {
        if (this.stdioConnections.has(server.id)) {
            const connection = this.stdioConnections.get(server.id);
            if (connection.isConnected && connection.isReady) {
                return connection;
            } else {
                // Remove stale connection
                this.stdioConnections.delete(server.id);
                if (connection.ws) {
                    connection.ws.close();
                }
            }
        }

        try {
            // Check if stdio server is running
            const healthCheck = await fetch('http://localhost:3003/health').catch(() => null);
            if (!healthCheck || !healthCheck.ok) {
                console.warn('Stdio MCP server not running. Please start it with: node stdio-mcp-server.js');
                return null;
            }
            
            // Create a new stdio connection
            const connection = await this.createStdioConnection(server);
            this.stdioConnections.set(server.id, connection);
            return connection;
        } catch (error) {
            console.error(`Failed to create stdio connection for ${server.name}:`, error);
            return null;
        }
    }

    async createStdioConnection(server) {
        return new Promise((resolve, reject) => {
            console.log(`Attempting to connect to stdio MCP server for ${server.name}...`);
            
            const ws = new WebSocket('ws://localhost:3003');
            
            const connection = {
                ws: ws,
                serverId: server.id,
                pendingCalls: new Map(),
                isConnected: false,
                isReady: false
            };
            
            ws.onopen = () => {
                console.log(`WebSocket connected to stdio MCP server for ${server.name}`);
                connection.isConnected = true;
                
                // Connect to the MCP server
                ws.send(JSON.stringify({
                    type: 'connect',
                    serverId: server.id,
                    params: {
                        command: server.command || server.url,
                        env: server.env || {}
                    }
                }));
            };
            
            ws.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    this.handleStdioMessage(connection, message, resolve);
                } catch (error) {
                    console.error(`Failed to parse WebSocket message:`, error);
                }
            };
            
            ws.onerror = (error) => {
                console.error(`WebSocket error for ${server.name}:`, error);
                reject(new Error(`WebSocket connection failed: ${error.message || 'Unknown error'}`));
            };
            
            ws.onclose = (event) => {
                console.log(`WebSocket closed for ${server.name}:`, event.code, event.reason);
                connection.isConnected = false;
                connection.isReady = false;
            };
            
            // Set a timeout for connection
            setTimeout(() => {
                if (!connection.isReady) {
                    ws.close();
                    reject(new Error('Connection timeout - stdio MCP server not ready'));
                }
            }, 15000);
            
            // Don't resolve immediately - wait for the server to be ready
        });
    }

    handleStdioMessage(connection, message, resolveConnection) {
        console.log(`Received message from ${connection.serverId}:`, message.type);
        
        switch (message.type) {
            case 'connected':
                if (message.status === 'ready') {
                    console.log(`MCP server ${connection.serverId} ready`);
                    connection.isReady = true;
                    if (resolveConnection) {
                        resolveConnection(connection);
                    }
                } else if (message.status === 'already_connected') {
                    console.log(`MCP server ${connection.serverId} already connected`);
                    connection.isReady = true;
                    if (resolveConnection) {
                        resolveConnection(connection);
                    }
                }
                break;
            case 'response':
                console.log(`Received response:`, message);
                console.log(`Pending calls:`, Array.from(connection.pendingCalls.entries()));
                
                // Try to find the pending call by callId first, then by method
                let foundCall = null;
                
                if (message.callId && connection.pendingCalls.has(message.callId)) {
                    foundCall = { callId: message.callId, call: connection.pendingCalls.get(message.callId) };
                    console.log(`Found call by callId: ${message.callId}`);
                } else {
                    // Fallback: find by method name
                    for (const [callId, call] of connection.pendingCalls.entries()) {
                        if (message.method === call.method) {
                            foundCall = { callId, call };
                            console.log(`Found call by method: ${message.method} -> ${callId}`);
                            break;
                        }
                    }
                }
                
                if (foundCall) {
                    connection.pendingCalls.delete(foundCall.callId);
                    console.log(`Resolving call with result:`, message.result);
                    if (message.error) {
                        // Handle error object properly
                        const errorMessage = typeof message.error === 'object' 
                            ? message.error.message || JSON.stringify(message.error)
                            : message.error;
                        foundCall.call.reject(new Error(errorMessage));
                    } else {
                        foundCall.call.resolve(message.result);
                    }
                } else {
                    console.warn(`No pending call found for response:`, message);
                    console.warn(`Available pending calls:`, Array.from(connection.pendingCalls.keys()));
                }
                break;
            case 'error':
                console.error(`MCP server error:`, message.error);
                // If there's a pending connection resolution, reject it
                if (resolveConnection) {
                    const errorMessage = typeof message.error === 'object' 
                        ? message.error.message || JSON.stringify(message.error)
                        : message.error;
                    resolveConnection.reject(new Error(errorMessage));
                }
                break;
            default:
                console.log(`Unknown message type: ${message.type}`);
        }
    }

    async callStdioMethod(connection, method, params) {
        return new Promise((resolve, reject) => {
            if (!connection.isConnected) {
                reject(new Error('WebSocket connection not established'));
                return;
            }
            
            if (!connection.isReady) {
                reject(new Error('MCP server not ready'));
                return;
            }
            
            // Generate a unique call ID
            const callId = Date.now().toString();
            
            // Store the promise callbacks with the call ID
            connection.pendingCalls.set(callId, { resolve, reject, method });
            
            // Send the method call
            const message = {
                type: 'call',
                serverId: connection.serverId,
                method: method,
                params: params,
                callId: callId
            };
            
            console.log(`Sending method call:`, message);
            connection.ws.send(JSON.stringify(message));
            
            console.log(`Sent method call to ${connection.serverId}: ${method} (ID: ${callId})`);
            
            // Set a timeout
            setTimeout(() => {
                if (connection.pendingCalls.has(callId)) {
                    connection.pendingCalls.delete(callId);
                    reject(new Error(`Method call timeout: ${method}`));
                }
            }, 30000);
        });
    }

    async executeMcpTool(serverId, tool, params) {
        const server = this.mcpServers.find(s => s.id === serverId);
        if (!server) {
            throw new Error(`MCP server ${serverId} not found`);
        }

        if (server.transport === 'stdio') {
            // Execute stdio MCP tool
            const connection = await this.getStdioConnection(server);
            if (!connection) {
                throw new Error(`No stdio connection available for ${server.name}`);
            }
            
            console.log(`Executing stdio tool: ${tool} with params:`, params);
            const result = await this.callStdioMethod(connection, tool, params);
            console.log(`Tool execution result:`, result);
            return result;
        } else {
            // Execute HTTP MCP tool
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
    }

    async processToolExecutions(response) {
        // Look for tool execution patterns in the AI response
        const toolExecutionRegex = /window\.executeMcpTool\(['"]([^'"]+)['"],\s*['"]([^'"]+)['"],\s*(\{[^}]*\})\)/g;
        
        // Also look for tool execution patterns inside code blocks
        const codeBlockRegex = /```(?:javascript|js)?\s*\n?window\.executeMcpTool\(['"]([^'"]+)['"],\s*['"]([^'"]+)['"],\s*(\{[^}]*\})\)\s*\n?```/g;
        let match;
        let processedResponse = response;
        
        console.log('Processing response for tool executions:', response);
        
        // First try the strict pattern
        while ((match = toolExecutionRegex.exec(response)) !== null) {
            const [fullMatch, serverId, toolName, paramsStr] = match;
            
            try {
                // Parse the parameters
                console.log('Attempting to parse params (pattern 1):', paramsStr);
                
                // Convert JavaScript object syntax to valid JSON
                let jsonParams = paramsStr;
                // Remove JavaScript comments (both // and /* */)
                jsonParams = jsonParams.replace(/\/\/.*$/gm, ''); // Remove single-line comments
                jsonParams = jsonParams.replace(/\/\*[\s\S]*?\*\//g, ''); // Remove multi-line comments
                // Replace unquoted property names with quoted ones
                jsonParams = jsonParams.replace(/(\w+):/g, '"$1":');
                // Replace single quotes with double quotes
                jsonParams = jsonParams.replace(/'/g, '"');
                // Remove trailing commas before closing braces/brackets
                jsonParams = jsonParams.replace(/,(\s*[}\]])/g, '$1');
                
                console.log('Converted to JSON:', jsonParams);
                const params = JSON.parse(jsonParams);
                
                console.log(`Executing tool: ${toolName} on server ${serverId} with params:`, params);
                
                // Execute the tool
                const result = await this.executeMcpTool(serverId, toolName, params);
                
                // Replace the function call with the formatted result
                const formattedResult = this.formatToolResult(result);
                processedResponse = processedResponse.replace(fullMatch, formattedResult);
                
            } catch (error) {
                console.error(`Failed to execute tool ${toolName}:`, error);
                const errorStr = `**❌ Tool Execution Error:** ${error.message}`;
                processedResponse = processedResponse.replace(fullMatch, errorStr);
            }
        }
        
        // Look for tool execution patterns inside code blocks
        while ((match = codeBlockRegex.exec(processedResponse)) !== null) {
            const [fullMatch, serverId, toolName, paramsStr] = match;
            
            try {
                // Parse the parameters
                console.log('Attempting to parse params (code block):', paramsStr);
                
                // Convert JavaScript object syntax to valid JSON
                let jsonParams = paramsStr;
                // Remove JavaScript comments (both // and /* */)
                jsonParams = jsonParams.replace(/\/\/.*$/gm, ''); // Remove single-line comments
                jsonParams = jsonParams.replace(/\/\*[\s\S]*?\*\//g, ''); // Remove multi-line comments
                // Replace unquoted property names with quoted ones
                jsonParams = jsonParams.replace(/(\w+):/g, '"$1":');
                // Replace single quotes with double quotes
                jsonParams = jsonParams.replace(/'/g, '"');
                // Remove trailing commas before closing braces/brackets
                jsonParams = jsonParams.replace(/,(\s*[}\]])/g, '$1');
                
                console.log('Converted to JSON:', jsonParams);
                const params = JSON.parse(jsonParams);
                
                console.log(`Executing tool (code block): ${toolName} on server ${serverId} with params:`, params);
                
                // Execute the tool
                const result = await this.executeMcpTool(serverId, toolName, params);
                
                // Replace the function call with the formatted result
                const formattedResult = this.formatToolResult(result);
                processedResponse = processedResponse.replace(fullMatch, formattedResult);
                
            } catch (error) {
                console.error(`Failed to execute tool ${toolName}:`, error);
                const errorStr = `**❌ Tool Execution Error:** ${error.message}`;
                processedResponse = processedResponse.replace(fullMatch, errorStr);
            }
        }
        
        // Also look for simpler patterns like: executeMcpTool('serverId', 'toolName', {params})
        const simplePattern = /executeMcpTool\(['"]([^'"]+)['"],\s*['"]([^'"]+)['"],\s*(\{[^}]*\})\)/g;
        while ((match = simplePattern.exec(processedResponse)) !== null) {
            const [fullMatch, serverId, toolName, paramsStr] = match;
            
            try {
                // Parse the parameters
                console.log('Attempting to parse params (simple pattern):', paramsStr);
                
                // Convert JavaScript object syntax to valid JSON
                let jsonParams = paramsStr;
                // Remove JavaScript comments (both // and /* */)
                jsonParams = jsonParams.replace(/\/\/.*$/gm, ''); // Remove single-line comments
                jsonParams = jsonParams.replace(/\/\*[\s\S]*?\*\//g, ''); // Remove multi-line comments
                // Replace unquoted property names with quoted ones
                jsonParams = jsonParams.replace(/(\w+):/g, '"$1":');
                // Replace single quotes with double quotes
                jsonParams = jsonParams.replace(/'/g, '"');
                // Remove trailing commas before closing braces/brackets
                jsonParams = jsonParams.replace(/,(\s*[}\]])/g, '$1');
                
                console.log('Converted to JSON:', jsonParams);
                const params = JSON.parse(jsonParams);
                
                console.log(`Executing tool (simple pattern): ${toolName} on server ${serverId} with params:`, params);
                
                // Execute the tool
                const result = await this.executeMcpTool(serverId, toolName, params);
                
                // Replace the function call with the formatted result
                const formattedResult = this.formatToolResult(result);
                processedResponse = processedResponse.replace(fullMatch, formattedResult);
                
            } catch (error) {
                console.error(`Failed to execute tool ${toolName}:`, error);
                const errorStr = `**❌ Tool Execution Error:** ${error.message}`;
                processedResponse = processedResponse.replace(fullMatch, errorStr);
            }
        }
        
        return processedResponse;
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
        
        // Add critical instruction to force tool execution
        const criticalInstruction = "\n\nCRITICAL INSTRUCTION: When users ask for specific actions, you MUST include the tool execution code in your response. Do NOT just say 'I will check' - actually include the code like: window.executeMcpTool('mdev1df57ar85i4luoi', 'page-status', {org: 'aemsites', site: 'da-blog-tools', path: '/'})\n\nIMPORTANT: For rum-data tool, use lowercase parameter names: domainkey, url, aggregation, startdate, enddate. Valid aggregation values: 'pageviews', 'visits', 'bounces', 'organic', 'earned', 'lcp', 'cls', 'inp', 'ttfb', 'engagement', 'errors'\n";
        
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
                console.log('MCP Data being sent to AI:', context.mcpData);
                systemMessage += "\n\n=== AVAILABLE MCP TOOLS AND CAPABILITIES ===\n";
                Object.keys(context.mcpData).forEach(serverId => {
                    const data = context.mcpData[serverId];
                    if (data && typeof data === 'object') {
                        systemMessage += `\n${serverId} server:\n`;
                        systemMessage += `- Status: ${data.status || 'unknown'}\n`;
                        systemMessage += `- Transport: ${data.transport || 'unknown'}\n`;
                        
                        if (data.tools && Array.isArray(data.tools) && data.tools.length > 0) {
                            systemMessage += `- Available Tools (${data.tools.length}):\n`;
                            data.tools.forEach(tool => {
                                systemMessage += `  * ${tool.name}: ${tool.title || tool.description || 'No description'}\n`;
                            });
                        } else {
                            systemMessage += `- Available Tools: None found\n`;
                        }
                        
                        if (data.resources && Array.isArray(data.resources) && data.resources.length > 0) {
                            systemMessage += `- Available Resources (${data.resources.length}):\n`;
                            data.resources.forEach(resource => {
                                systemMessage += `  * ${resource.name}: ${resource.title || resource.description || 'No description'}\n`;
                            });
                        }
                        
                        if (data.error) {
                            systemMessage += `- Error: ${data.error}\n`;
                        }
                    }
                });
                
                systemMessage += "\n=== INSTRUCTIONS ===\n";
                systemMessage += "You have access to the above MCP tools and can use them to help users. ";
                systemMessage += "When users ask about system information, files, or need to perform actions, ";
                systemMessage += "you can leverage these tools to provide accurate and helpful responses.\n\n";
                systemMessage += "TO EXECUTE TOOLS: You can execute tools by calling the global function:\n";
                systemMessage += "window.executeMcpTool(serverId, toolName, parameters)\n\n";
                systemMessage += "For example:\n";
                systemMessage += "- To check page status: window.executeMcpTool('mdev1df57ar85i4luoi', 'page-status', {org: 'aemsites', site: 'da-blog-tools', path: '/some-page'})\n";
                systemMessage += "- To echo a message: window.executeMcpTool('mdev1df57ar85i4luoi', 'echo', {message: 'Hello world'})\n\n";
                systemMessage += "When users request specific actions, actually execute the appropriate tools and show the results.\n";
            }
        }

        // Add critical instruction to force tool execution
        systemMessage += criticalInstruction;
        
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
                console.log('MCP Data being sent to AI:', context.mcpData);
                systemMessage += "\n\n=== AVAILABLE MCP TOOLS AND CAPABILITIES ===\n";
                Object.keys(context.mcpData).forEach(serverId => {
                    const data = context.mcpData[serverId];
                    if (data && typeof data === 'object') {
                        systemMessage += `\n${serverId} server:\n`;
                        systemMessage += `- Status: ${data.status || 'unknown'}\n`;
                        systemMessage += `- Transport: ${data.transport || 'unknown'}\n`;
                        
                        if (data.tools && Array.isArray(data.tools) && data.tools.length > 0) {
                            systemMessage += `- Available Tools (${data.tools.length}):\n`;
                            data.tools.forEach(tool => {
                                systemMessage += `  * ${tool.name}: ${tool.title || tool.description || 'No description'}\n`;
                            });
                        } else {
                            systemMessage += `- Available Tools: None found\n`;
                        }
                        
                        if (data.resources && Array.isArray(data.resources) && data.resources.length > 0) {
                            systemMessage += `- Available Resources (${data.resources.length}):\n`;
                            data.resources.forEach(resource => {
                                systemMessage += `  * ${resource.name}: ${resource.title || resource.description || 'No description'}\n`;
                            });
                        }
                        
                        if (data.error) {
                            systemMessage += `- Error: ${data.error}\n`;
                        }
                    }
                });
                
                systemMessage += "\n=== INSTRUCTIONS ===\n";
                systemMessage += "You have access to the above MCP tools and can use them to help users. ";
                systemMessage += "When users ask about system information, files, or need to perform actions, ";
                systemMessage += "you can leverage these tools to provide accurate and helpful responses.\n\n";
                systemMessage += "TO EXECUTE TOOLS: You can execute tools by calling the global function:\n";
                systemMessage += "window.executeMcpTool(serverId, toolName, parameters)\n\n";
                systemMessage += "For example:\n";
                systemMessage += "- To check page status: window.executeMcpTool('mdev1df57ar85i4luoi', 'page-status', {org: 'aemsites', site: 'da-blog-tools', path: '/some-page'})\n";
                systemMessage += "- To echo a message: window.executeMcpTool('mdev1df57ar85i4luoi', 'echo', {message: 'Hello world'})\n\n";
                systemMessage += "When users request specific actions, actually execute the appropriate tools and show the results.\n";
            }
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

    formatToolResult(result) {
        try {
            // If result is a string that contains JSON, parse it
            let data = result;
            if (typeof result === 'string') {
                try {
                    data = JSON.parse(result);
                } catch (e) {
                    // If it's not JSON, return as is
                    return result;
                }
            }

            // Handle different result structures
            if (data && typeof data === 'object') {
                // If it has a content array with text (like the page-status result)
                if (data.content && Array.isArray(data.content)) {
                    const textContent = data.content.find(item => item.type === 'text');
                    if (textContent && textContent.text) {
                        try {
                            const parsedContent = JSON.parse(textContent.text);
                            return this.formatPageStatusResult(parsedContent);
                        } catch (e) {
                            return textContent.text;
                        }
                    }
                }
                
                // If it's a simple object, format it nicely
                return this.formatObjectResult(data);
            }
            
            return JSON.stringify(data, null, 2);
        } catch (error) {
            return JSON.stringify(result, null, 2);
        }
    }

    formatPageStatusResult(data) {
        let formatted = '\n\n**📄 Page Status Results**\n\n';
        
        // Basic info
        if (data.webPath) {
            formatted += `**Path:** \`${data.webPath}\`\n`;
        }
        if (data.resourcePath) {
            formatted += `**Resource:** \`${data.resourcePath}\`\n`;
        }
        formatted += '\n';
        
        // Live status
        if (data.live) {
            formatted += '**🌐 Live Environment**\n';
            formatted += `- **URL:** [${data.live.url}](${data.live.url})\n`;
            formatted += `- **Status:** ${this.getStatusBadge(data.live.status)}\n`;
            if (data.live.contentBusId) {
                formatted += `- **Content Bus ID:** \`${data.live.contentBusId}\`\n`;
            }
            if (data.live.permissions) {
                formatted += `- **Permissions:** ${data.live.permissions.join(', ')}\n`;
            }
            formatted += '\n';
        }
        
        // Preview status
        if (data.preview) {
            formatted += '**👁️ Preview Environment**\n';
            formatted += `- **URL:** [${data.preview.url}](${data.preview.url})\n`;
            formatted += `- **Status:** ${this.getStatusBadge(data.preview.status)}\n`;
            if (data.preview.contentBusId) {
                formatted += `- **Content Bus ID:** \`${data.preview.contentBusId}\`\n`;
            }
            if (data.preview.permissions) {
                formatted += `- **Permissions:** ${data.preview.permissions.join(', ')}\n`;
            }
            formatted += '\n';
        }
        
        // Code status
        if (data.code) {
            formatted += '**💻 Code Environment**\n';
            formatted += `- **Status:** ${this.getStatusBadge(data.code.status)}\n`;
            if (data.code.codeBusId) {
                formatted += `- **Code Bus ID:** \`${data.code.codeBusId}\`\n`;
            }
            if (data.code.permissions) {
                formatted += `- **Permissions:** ${data.code.permissions.join(', ')}\n`;
            }
            formatted += '\n';
        }
        
        // Links
        if (data.links) {
            formatted += '**🔗 Admin Links**\n';
            Object.entries(data.links).forEach(([key, url]) => {
                formatted += `- **${key.charAt(0).toUpperCase() + key.slice(1)}:** [${url}](${url})\n`;
            });
        }
        
        return formatted;
    }

    formatObjectResult(data) {
        let formatted = '\n\n**📊 Tool Results**\n\n';
        
        Object.entries(data).forEach(([key, value]) => {
            if (typeof value === 'object' && value !== null) {
                formatted += `**${key}:**\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n\n`;
            } else {
                formatted += `**${key}:** \`${value}\`\n\n`;
            }
        });
        
        return formatted;
    }

    getStatusBadge(status) {
        if (status === 200) {
            return '🟢 **200 OK**';
        } else if (status === 404) {
            return '🔴 **404 Not Found**';
        } else if (status >= 500) {
            return '🔴 **Server Error**';
        } else if (status >= 400) {
            return '🟡 **Client Error**';
        } else {
            return `⚪ **${status}**`;
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
        
        const transport = formData.get('mcpTransport') || document.getElementById('mcpTransport').value;
        
        const serverData = {
            name: formData.get('mcpName') || document.getElementById('mcpName').value,
            transport: transport,
            auth: formData.get('mcpAuth') || document.getElementById('mcpAuth').value,
            description: formData.get('mcpDescription') || document.getElementById('mcpDescription').value
        };
        
        if (transport === 'http') {
            serverData.url = formData.get('mcpUrl') || document.getElementById('mcpUrl').value;
            if (!serverData.name || !serverData.url) {
                alert('Please fill in all required fields');
                return;
            }
        } else {
            serverData.command = formData.get('mcpCommand') || document.getElementById('mcpCommand').value;
            if (!serverData.name || !serverData.command) {
                alert('Please fill in all required fields');
                return;
            }
            
            // Parse environment variables
            const envText = formData.get('mcpEnv') || document.getElementById('mcpEnv').value;
            if (envText.trim()) {
                try {
                    serverData.env = JSON.parse(envText);
                } catch (error) {
                    alert('Invalid JSON in environment variables field');
                    return;
                }
            }
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

    setDaTokenForMcpServers(token) {
        if (!token) {
            console.warn('No DA token available for MCP servers');
            return;
        }

        // Store the token for later use
        this.daToken = token;

        // Update existing MCP servers that need the DA token
        let updated = false;
        this.mcpServers.forEach(server => {
            if (server.transport === 'stdio' && server.command && server.command.includes('helix-mcp')) {
                if (!server.env) {
                    server.env = {};
                }
                
                // Set DA_ADMIN_API_TOKEN
                if (server.env.DA_ADMIN_API_TOKEN !== token) {
                    server.env.DA_ADMIN_API_TOKEN = token;
                    updated = true;
                    console.log(`Updated DA_ADMIN_API_TOKEN for ${server.name}`);
                }
                
                // Set HELIX_ADMIN_API_TOKEN if not present (use DA token as fallback)
                if (!server.env.HELIX_ADMIN_API_TOKEN) {
                    server.env.HELIX_ADMIN_API_TOKEN = token;
                    updated = true;
                    console.log(`Set HELIX_ADMIN_API_TOKEN for ${server.name} (using DA token as fallback)`);
                }
            }
        });

        if (updated) {
            this.saveConfiguration();
            this.updateMcpServersList();
        }
    }

    getDaToken() {
        return this.daToken;
    }

    async refreshDaToken() {
        try {
            const { token } = await DA_SDK;
            if (token && token !== this.daToken) {
                this.setDaTokenForMcpServers(token);
                console.log('DA token refreshed');
            }
            return token;
        } catch (error) {
            console.error('Failed to refresh DA token:', error);
            return null;
        }
    }
}

// Global function for AI to execute MCP tools
window.executeMcpTool = async function(serverId, tool, params) {
    if (window.daChatInstance) {
        try {
            const result = await window.daChatInstance.executeMcpTool(serverId, tool, params);
            return { success: true, result };
        } catch (error) {
            return { success: false, error: error.message };
        }
    } else {
        return { success: false, error: 'DA Chat not initialized' };
    }
};

// Initialize the chat when the page loads
document.addEventListener('DOMContentLoaded', () => {
    window.daChatInstance = new DAChat();
});
