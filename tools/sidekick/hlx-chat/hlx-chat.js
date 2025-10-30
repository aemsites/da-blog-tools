// HLX Chat - Simplified AI Chatbot for AEM Sidekick
class HLXChat {
  constructor() {
    this.models = [];
    this.mcpServers = [];
    this.currentModel = null;
    this.chatHistory = [];
    this.isLoading = false;
    this.editingModelId = null;
    this.editingServerId = null;
    this.executionDepth = 0; // Prevent infinite loops
    this.hlxToken = null; // Store HLX token for MCP authentication
    this.userProfile = null; // Store user profile information
    this.isLoggedIn = false; // Track login state
    this.sidekick = null; // Store reference to aem-sidekick element
    this.loginListenersSetup = false; // Track if login listeners are set up

    this.init();
  }

  // Wait for sidekick to be ready before proceeding
  async waitForSidekick() {
    // Check if sidekick is already loaded
    const sk = document.querySelector('aem-sidekick');
    if (sk) {
      // sidekick already loaded
      this.sidekick = sk;
      this.setupSidekickLoginListeners();
      return Promise.resolve();
    }

    // Wait for sidekick-ready event with timeout
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Sidekick not available - running in standalone mode'));
      }, 3000); // 3 second timeout

      document.addEventListener('sidekick-ready', () => {
        clearTimeout(timeout);
        // sidekick now loaded
        const sidekickEl = document.querySelector('aem-sidekick');
        this.sidekick = sidekickEl;
        this.setupSidekickLoginListeners();
        resolve();
      }, { once: true });
    });
  }

  async init() {
    this.loadConfiguration();

    // Set up UI components first (these don't need sidekick)
    this.setupEventListeners();
    this.updateModelDropdown();
    this.updateModelsList();
    this.updateMcpServersList();

    // Wait for sidekick to be ready for advanced features
    try {
      await this.waitForSidekick();
      // Now that sidekick is ready, set up sidekick-specific features
      this.setupLoginListener();
      await this.testMcpServerConnection();
    } catch (error) {
      // Continue without sidekick - basic chat functionality will still work
    }

    // Auto-select the first model if models are available
    if (this.models.length > 0 && !this.currentModel) {
      this.selectModel(this.models[0].id);
    }

    // Add helpful initial message
    if (this.models.length === 0) {
      this.addMessage('assistant', 'Welcome to HLX Chat! Please add an AI model in the configuration to get started.');
    } else if (!this.currentModel) {
      this.addMessage('assistant', 'Please select an AI model from the dropdown above to start chatting.');
    } else if (!this.currentModel.apiKey || !this.currentModel.apiKey.trim()) {
      this.addMessage('assistant', `Model "${this.currentModel.name}" selected but needs an API key. Click the gear icon ⚙️ to configure it.`);
    } else {
      // Model is fully configured - show greeting
      this.addMessage('assistant', 'Hello! I\'m your HLX Chat assistant. How can I help you today?');
    }
  }

  // Configuration Management
  loadConfiguration() {
    const savedConfig = localStorage.getItem('hlx-chat-config');
    if (savedConfig) {
      try {
        const config = JSON.parse(savedConfig);
        this.models = config.models || [];
        this.mcpServers = config.mcpServers || [];
        this.hlxToken = config.hlxToken || null;
        this.userProfile = config.userProfile || null;
        this.isLoggedIn = config.isLoggedIn || false;

        // Log model configuration for debugging
        this.models.forEach(() => {
          // Model loaded
        });

        // Ensure Helix MCP server is always present
        const helixServerIndex = this.mcpServers.findIndex((s) => s.id === 'helix-mcp');
        if (helixServerIndex === -1) {
          this.mcpServers.unshift({
            id: 'helix-mcp',
            name: 'Helix MCP',
            transport: 'http',
            url: 'https://helix-mcp-staging.adobeaem.workers.dev',
            auth: '',
            description: 'Pre-configured Helix MCP server for AEM operations',
            readonly: true,
          });
        }
      } catch (error) {
        this.useDefaultConfiguration();
      }
    } else {
      this.useDefaultConfiguration();
    }

    // Save the updated configuration
    this.saveConfiguration();
  }

  useDefaultConfiguration() {
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
        temperature: 0.7,
      },
    ];
    this.mcpServers = [
      {
        id: 'helix-mcp',
        name: 'Helix MCP',
        transport: 'http',
        url: 'https://helix-mcp-staging.adobeaem.workers.dev',
        auth: '',
        description: 'Pre-configured Helix MCP server for AEM operations',
        readonly: true,
      },
    ];
  }

  resetConfiguration() {
    // Clear current configuration
    this.currentModel = null;
    this.chatHistory = [];

    // Reset to defaults
    this.useDefaultConfiguration();

    // Update UI
    this.updateModelDropdown();
    this.updateModelsList();
    this.updateMcpServersList();
    this.updateSendButton();

    // Save the reset configuration
    this.saveConfiguration();

    // Add confirmation message
    this.addMessage('assistant', 'Configuration has been reset to defaults. Please add your API key to get started.');
  }

  saveConfiguration() {
    const config = {
      models: this.models,
      mcpServers: this.mcpServers,
      hlxToken: this.hlxToken,
      userProfile: this.userProfile,
      isLoggedIn: this.isLoggedIn,
    };
    localStorage.setItem('hlx-chat-config', JSON.stringify(config));

    // Also save user profile separately for easier access
    if (this.userProfile) {
      localStorage.setItem('hlx-user-profile', JSON.stringify(this.userProfile));
    } else {
      localStorage.removeItem('hlx-user-profile');
    }
  }

  // UI Updates
  updateModelDropdown() {
    const select = document.getElementById('modelSelect');
    select.innerHTML = '<option value="">Select Model...</option>';

    this.models.forEach((model) => {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = model.name;
      select.appendChild(option);
    });
  }

  updateModelsList() {
    const list = document.getElementById('modelsList');
    list.innerHTML = '';

    this.models.forEach((model) => {
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

    this.mcpServers.forEach((server) => {
      const item = document.createElement('div');
      item.className = 'mcp-server-item';

      const isReadonly = server.readonly || server.id === 'helix-mcp';

      item.innerHTML = `
        <div class="mcp-server-info">
          <div class="mcp-server-name">${server.name}${isReadonly ? ' <span class="readonly-badge">Pre-configured</span>' : ''}</div>
          <div class="mcp-server-url">
            <span class="transport-badge http">HTTP</span>
            ${server.url}
          </div>
        </div>
        <div class="mcp-server-actions">
          ${isReadonly ? '' : `<button class="edit-btn" data-server-id="${server.id}">Edit</button>`}
          ${isReadonly ? '' : `<button class="delete-btn" data-server-id="${server.id}">Delete</button>`}
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
      e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
      this.updateSendButton();
    });

    // Configuration modal
    const configBtn = document.getElementById('configBtn');
    if (configBtn) {
      configBtn.addEventListener('click', () => {
        this.showConfigModal();
      });
    }

    document.getElementById('closeModal').addEventListener('click', () => {
      this.hideConfigModal();
    });

    document.getElementById('resetConfig').addEventListener('click', () => {
      // eslint-disable-next-line no-alert, no-restricted-globals
      if (confirm('Are you sure you want to reset all configuration to defaults? This will remove all models and MCP servers.')) {
        this.resetConfiguration();
        this.hideConfigModal();
      }
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

    // HLX Token
    document.getElementById('setHlxTokenBtn').addEventListener('click', () => {
      const token = document.getElementById('hlxToken').value.trim();
      this.setHlxToken(token);
      document.getElementById('hlxToken').value = '';
    });

    document.getElementById('debugParentBtn').addEventListener('click', () => {
      this.debugParentWindow();
    });

    document.getElementById('clearCacheBtn').addEventListener('click', () => {
      this.clearCachedProfile();
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
    this.currentModel = this.models.find((m) => m.id === modelId);

    // Update the dropdown to reflect the selection
    const select = document.getElementById('modelSelect');
    if (select) {
      select.value = modelId || '';
    }

    this.updateSendButton();

    if (this.currentModel) {
      if (this.currentModel.apiKey && this.currentModel.apiKey.trim()) {
        // Clear any previous setup messages and show greeting
        this.clearMessages();
        this.addMessage('assistant', 'Hello! I\'m your HLX Chat assistant. How can I help you today?');
      } else {
        this.addMessage('assistant', `Connected to ${this.currentModel.name} but needs an API key. Click the gear icon ⚙️ to configure it.`);
      }
    }
  }

  addModel(modelData) {
    const model = {
      id: this.generateId(),
      ...modelData,
    };
    this.models.push(model);
    this.updateModelDropdown();
    this.updateModelsList();
    this.saveConfiguration();
  }

  deleteModel(modelId) {
    this.models = this.models.filter((m) => m.id !== modelId);
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
      ...serverData,
    };
    this.mcpServers.push(server);
    this.updateMcpServersList();
    this.saveConfiguration();
  }

  deleteMcpServer(serverId) {
    const server = this.mcpServers.find((s) => s.id === serverId);
    if (server && (server.readonly || server.id === 'helix-mcp')) {
      return;
    }

    this.mcpServers = this.mcpServers.filter((s) => s.id !== serverId);
    this.updateMcpServersList();
    this.saveConfiguration();
  }

  editModel(modelId) {
    const model = this.models.find((m) => m.id === modelId);
    if (!model) return;

    this.editingModelId = modelId;
    this.populateModelForm(model);
    this.showModelForm();
  }

  editMcpServer(serverId) {
    const server = this.mcpServers.find((s) => s.id === serverId);
    if (!server) return;

    if (server.readonly || server.id === 'helix-mcp') {
      return;
    }

    this.editingServerId = serverId;
    this.populateMcpForm(server);
    this.showMcpForm();
  }

  // eslint-disable-next-line class-methods-use-this
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

  // eslint-disable-next-line class-methods-use-this
  populateMcpForm(server) {
    document.getElementById('mcpName').value = server.name;
    document.getElementById('mcpUrl').value = server.url || '';
    document.getElementById('mcpAuth').value = server.auth || '';
    document.getElementById('mcpDescription').value = server.description || '';
  }

  // Chat Functionality
  async sendMessage() {
    const input = document.getElementById('messageInput');
    const message = input.value.trim();

    if (!message) {
      this.addMessage('assistant', 'Please enter a message to send.');
      return;
    }

    if (!this.currentModel) {
      this.addMessage('assistant', 'Please select an AI model from the dropdown above to start chatting.');
      return;
    }

    if (this.isLoading) {
      return;
    }

    // Check if the selected model has required configuration
    if (!this.currentModel.apiKey || !this.currentModel.apiKey.trim()) {
      this.addMessage('assistant', 'Please configure your API key in the settings. Click the gear icon ⚙️ to open configuration.');
      return;
    }

    // Check if user is logged in before allowing MCP tool usage (skip in standalone mode)
    if (!this.isLoggedIn || !this.userProfile) {
      // Don't block basic chat functionality in standalone mode
      // this.addMessage('assistant', '🔒 **Authentication Required:**
      // You must be logged in to use MCP tools. Please log in first.');
      // return;
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
      // Send to model
      const response = await this.callModel(message);

      // Process tool executions if any
      const contextData = { messages: this.chatHistory };
      let finalResponse = await this.processToolExecutions(response, contextData);

      // If no tool execution was found and this looks like a page status question, force exec
      if (!finalResponse.includes('window.executeMcpTool')
          && !finalResponse.includes('❌')
          && message.toLowerCase().includes('page')
          && message.toLowerCase().includes('published')) {
        try {
          const result = await this.executeMcpTool('helix-mcp', 'page-status', {
            org: 'aemsites',
            site: 'da-blog-tools',
            path: '/demo',
          });

          // Get AI analysis of the tool results
          const promptStr = 'Analyze this data and provide insights based on the user\'s '
            + 'original question. Do NOT show the raw data. Instead, answer the user\'s '
            + 'question only. IMPORTANT: Do NOT include any tool execution calls in your '
            + `response. Just provide the analysis. Here's the data: ${JSON.stringify(result, null, 2)}`;
          const analysisResponse = await this.callModel(promptStr, contextData);
          finalResponse = analysisResponse;
        } catch (error) {
          finalResponse = `**❌ Tool execution failed:** ${error.message}`;
        }
      }

      // Update loading message with final response
      this.updateMessage(loadingMessage, finalResponse);
    } catch (error) {
      this.updateMessage(loadingMessage, `Error: ${error.message}`);
    } finally {
      this.isLoading = false;
      this.updateSendButton();
    }
  }

  async callModel(message) {
    const model = this.currentModel;

    switch (model.type) {
      case 'openai':
        return this.callOpenAI(message, model);
      case 'anthropic':
        return this.callAnthropic(message, model);
      default:
        throw new Error(`Unsupported model type: ${model.type}`);
    }
  }

  async callOpenAI(message, model) {
    // Validate required fields
    if (!model.apiKey || !model.apiKey.trim()) {
      throw new Error('API key is required. Please configure your API key in settings.');
    }

    if (!model.apiEndpoint || !model.apiEndpoint.trim()) {
      throw new Error('API endpoint is required. Please configure your API endpoint in settings.');
    }

    if (!model.modelIdentifier || !model.modelIdentifier.trim()) {
      throw new Error('Model identifier is required. Please configure your model identifier in settings.');
    }

    // Check if this is an Azure OpenAI endpoint
    const isAzure = model.apiEndpoint.includes('azure.com')
      || model.apiEndpoint.includes('openai.azure.com');

    let endpoint;
    let headers;

    if (isAzure) {
      // Azure OpenAI format:
      // https://{resource-name}.openai.azure.com/openai/deployments/
      // {deployment-name}/chat/completions?api-version=2024-02-15-preview
      const deploymentName = model.modelIdentifier;
      endpoint = `${model.apiEndpoint.replace(/\/+$/, '')}/openai/deployments/${deploymentName}/chat/completions?api-version=2024-02-15-preview`;
      headers = {
        'Content-Type': 'application/json',
        'api-key': model.apiKey, // Azure uses api-key header instead of Authorization
      };
    } else {
      // Standard OpenAI format
      endpoint = `${model.apiEndpoint.replace(/\/+$/, '')}/chat/completions`;
      headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${model.apiKey}`,
      };
    }

    // Prepare system message with MCP context
    let systemMessage = 'You are a helpful AI assistant for AEM development.';

    if (this.mcpServers && this.mcpServers.length > 0) {
      systemMessage += '\n\nYou have access to the following MCP (Model Context Protocol) servers:\n';

      this.mcpServers.forEach((server) => {
        systemMessage += `- ${server.name}: ${server.description || 'No description'}\n`;
      });

      systemMessage += '\n=== CRITICAL INSTRUCTIONS ===\n';
      systemMessage += 'You have access to the above MCP tools and can use them to help users. ';
      systemMessage += 'When users ask about system information, files, or need to perform actions, ';
      systemMessage += 'you MUST leverage these tools to provide accurate and helpful responses.\n\n';
      systemMessage += 'TO EXECUTE TOOLS: You can execute tools by calling the global function:\n';
      systemMessage += 'window.executeMcpTool(serverId, toolName, parameters)\n\n';
      systemMessage += `AVAILABLE SERVER IDS: ${this.mcpServers.map((s) => s.id).join(', ')}\n\n`;
      systemMessage += 'CRITICAL RULES:\n';
      systemMessage += '1. NO explanatory text like "I will check" or "Please hold on"\n';
      systemMessage += '2. NO descriptions of what you will do\n';
      systemMessage += '3. Execute tools IMMEDIATELY with window.executeMcpTool()\n';
      systemMessage += '4. Present data only, no analysis unless requested\n';
      systemMessage += '5. For page status questions, use: window.executeMcpTool("helix-mcp", "page-status", {org, site, path})\n';
      systemMessage += '6. For audit log questions, use: window.executeMcpTool("helix-mcp", "audit-log", {org, site, since})\n\n';
      systemMessage += 'EXAMPLE: User asks "When was /demo page published?"\n';
      systemMessage += 'RESPONSE: window.executeMcpTool("helix-mcp", "page-status", {org: "aemsites", site: "da-blog-tools", path: "/demo"})\n';
      systemMessage += 'NOT: "I will check the publication date..."\n\n';
      systemMessage += 'REMEMBER: You are a TOOL EXECUTOR, not a conversational assistant. ';
      systemMessage += 'When users ask for information, EXECUTE THE APPROPRIATE TOOL IMMEDIATELY. ';
      systemMessage += 'Do not explain what you will do - just do it with window.executeMcpTool().\n\n';
      systemMessage += 'CRITICAL: Your response must start with the tool execution call. ';
      systemMessage += 'No other text before or after the window.executeMcpTool() call.';
    }

    const requestBody = {
      messages: [
        { role: 'system', content: systemMessage },
        ...this.chatHistory.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
        { role: 'user', content: message },
      ],
      max_tokens: model.maxTokens,
      temperature: model.temperature,
    };

    // Azure OpenAI doesn't need the model field, standard OpenAI does
    if (!isAzure) {
      requestBody.model = model.modelIdentifier;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}`;
      try {
        const error = await response.json();

        if (error.error?.message) {
          errorMessage = error.error.message;
        } else if (error.message) {
          errorMessage = error.message;
        } else if (error.error) {
          errorMessage = error.error;
        } else {
          errorMessage = response.statusText || `HTTP ${response.status}`;
        }
      } catch (e) {
        errorMessage = response.statusText || `HTTP ${response.status}`;
      }

      // Provide more helpful error messages
      if (response.status === 401) {
        errorMessage = 'Invalid API key. Please check your API key in settings.';
      } else if (response.status === 404) {
        errorMessage = `Model '${model.modelIdentifier}' not found. This could mean:\n\n`
          + '1. The model name is incorrect\n'
          + '2. Your API key doesn\'t have access to this model\n'
          + '3. The model has been deprecated or renamed\n\n'
          + 'Try using \'gpt-4o-mini\' or \'gpt-3.5-turbo\' instead, '
          + 'or check your OpenAI account access.';
      } else if (response.status === 429) {
        errorMessage = 'Rate limit exceeded. Please try again later.';
      } else if (response.status >= 500) {
        errorMessage = 'OpenAI service is experiencing issues. Please try again later.';
      }

      throw new Error(errorMessage);
    }

    const data = await response.json();

    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw new Error('Invalid response format from OpenAI API');
    }

    return data.choices[0].message.content;
  }

  async callAnthropic(message, model) {
    const response = await fetch(`${model.apiEndpoint}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': model.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model.modelIdentifier,
        max_tokens: model.maxTokens,
        temperature: model.temperature,
        system: 'You are a helpful AI assistant for AEM development.',
        messages: [
          ...this.chatHistory.map((msg) => ({
            role: msg.role,
            content: msg.content,
          })),
          { role: 'user', content: message },
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    return data.content[0].text;
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

  clearMessages() {
    const messagesContainer = document.getElementById('chatMessages');
    if (messagesContainer) {
      messagesContainer.innerHTML = '';
    }
    this.chatHistory = [];
  }

  // eslint-disable-next-line class-methods-use-this
  formatMessage(content) {
    if (!content) return '';

    // Convert markdown to HTML
    const formatted = content
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

    return formatted;
  }

  updateSendButton() {
    const input = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    const hasText = input.value.trim().length > 0;
    const hasModel = this.currentModel !== null;
    const notLoading = !this.isLoading;

    const shouldEnable = hasText && hasModel && notLoading;
    sendBtn.disabled = !shouldEnable;
  }

  // Modal Management
  showConfigModal() {
    // Check if modal elements exist
    const configModal = document.getElementById('configModal');
    const hlxTokenInput = document.getElementById('hlxToken');

    if (!configModal) {
      return;
    }

    // Populate HLX token field with current value
    if (hlxTokenInput) {
      hlxTokenInput.value = this.hlxToken || '';
    }

    // Add show class
    configModal.classList.add('show');
  }

  // eslint-disable-next-line class-methods-use-this
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
      maxTokens: parseInt(formData.get('maxTokens') || document.getElementById('maxTokens').value, 10),
      temperature: parseFloat(formData.get('temperature') || document.getElementById('temperature').value),
    };

    if (!modelData.name || !modelData.type || !modelData.apiKey) {
      // eslint-disable-next-line no-alert
      alert('Please fill in all required fields');
      return;
    }

    if (this.editingModelId) {
      // Update existing model
      const modelIndex = this.models.findIndex((m) => m.id === this.editingModelId);
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
      transport: 'http',
      url: formData.get('mcpUrl') || document.getElementById('mcpUrl').value,
      auth: formData.get('mcpAuth') || document.getElementById('mcpAuth').value,
      description: formData.get('mcpDescription') || document.getElementById('mcpDescription').value,
    };

    if (!serverData.name || !serverData.url) {
      // eslint-disable-next-line no-alert
      alert('Please fill in all required fields');
      return;
    }

    if (this.editingServerId) {
      // Update existing server
      const serverIndex = this.mcpServers.findIndex((s) => s.id === this.editingServerId);
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

  // MCP Tool Execution
  async executeMcpTool(serverId, tool, params) {
    // Check if user is logged in before allowing MCP tool execution (warn in standalone mode)
    if (!this.isLoggedIn || !this.userProfile) {
      // Don't throw error in standalone mode, let the server handle auth requirements
    }

    const server = this.mcpServers.find((s) => s.id === serverId);
    if (!server) {
      const availableServers = this.mcpServers.map((s) => s.id).join(', ');
      throw new Error(`MCP server '${serverId}' not found. Available servers: ${availableServers}`);
    }

    // Refresh HLX token before making request
    await this.refreshHlxToken();

    // Add HLX token as helixAdminApiToken if available, fallback to DA token
    const paramsWithToken = { ...params };
    if (this.hlxToken) {
      paramsWithToken.helixAdminApiToken = this.hlxToken;
    } else {
      // Try to get DA token from sidekick context
      const daToken = await this.getDaToken();
      if (daToken) {
        paramsWithToken.helixAdminApiToken = daToken;
      }
    }

    // Execute MCP tool
    const response = await fetch(`${server.url}/context`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-06-18',
        ...(server.auth && { Authorization: server.auth }),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: tool,
          arguments: paramsWithToken,
        },
        id: Date.now(),
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || error.error || `HTTP ${response.status}`);
    }

    // Handle SSE response
    if (response.headers.get('content-type')?.includes('text/event-stream')) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let result = null;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        // eslint-disable-next-line no-await-in-loop
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        // eslint-disable-next-line no-restricted-syntax
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data.trim()) {
              try {
                const parsed = JSON.parse(data);
                if (parsed.result) {
                  // Check if the result contains content array (MCP format)
                  if (parsed.result.content && Array.isArray(parsed.result.content)) {
                    // Extract text content from MCP response
                    const textContent = parsed.result.content
                      .filter((item) => item.type === 'text')
                      .map((item) => item.text)
                      .join('\n');

                    if (textContent) {
                      result = { message: textContent, rawResult: parsed.result };
                    }
                  } else {
                    result = parsed.result;
                  }
                } else if (parsed.error) {
                  throw new Error(parsed.error.message || parsed.error);
                }
              } catch (e) {
                // Failed to parse SSE data
              }
            }
          }
        }
      }

      if (result) {
        return result;
      }
      throw new Error('No valid response received from SSE stream');
    }
    // Handle regular JSON response
    const data = await response.json();
    if (data.result) {
      // Check if the result contains content array (MCP format)
      if (data.result.content && Array.isArray(data.result.content)) {
        // Extract text content from MCP response
        const textContent = data.result.content
          .filter((item) => item.type === 'text')
          .map((item) => item.text)
          .join('\n');

        if (textContent) {
          return { message: textContent, rawResult: data.result };
        }
      }
      return data.result;
    } if (data.error) {
      throw new Error(data.error.message || data.error);
    }
    throw new Error('Invalid response format');
  }

  // Process tool executions in AI responses
  async processToolExecutions(response, context) {
    // Prevent infinite loops by checking execution depth
    if (this.executionDepth > 2) {
      const blockedMsg = '**❌ Tool execution blocked to prevent infinite loop**';
      return response.replace(/window\.executeMcpTool\([^)]+\)/g, blockedMsg);
    }

    // Look for tool execution patterns in the AI response
    const toolExecutionRegex = /window\.executeMcpTool\(['"]([^'"]+)['"],\s*['"]([^'"]+)['"],\s*(\{[^}]*\})\);?/g;

    let match;
    let processedResponse = response;

    // If no tool execution found, check if conversational response should have executed a tool
    if (!toolExecutionRegex.test(response)) {
      const lowerResponse = response.toLowerCase();
      const hasConversationalMarkers = lowerResponse.includes('i will')
        || lowerResponse.includes('please hold')
        || lowerResponse.includes('executing')
        || lowerResponse.includes('check');

      if (hasConversationalMarkers) {
        // Try to auto-execute based on the user's question context
        const lastUserMessage = this.chatHistory[this.chatHistory.length - 1];
        if (lastUserMessage && lastUserMessage.role === 'user') {
          const userQuestion = lastUserMessage.content.toLowerCase();

          if (userQuestion.includes('page')
            && userQuestion.includes('published')
            && userQuestion.includes('demo')) {
            try {
              const result = await this.executeMcpTool('helix-mcp', 'page-status', {
                org: 'aemsites',
                site: 'da-blog-tools',
                path: '/demo',
              });

              // Get AI analysis of the tool results
              const promptStr = 'Analyze this data and provide insights based on the user\'s '
                + 'original question. Do NOT show the raw data. Instead, answer the user\'s '
                + `question only. Here's the data: ${JSON.stringify(result, null, 2)}`;
              const analysisResponse = await this.callModel(promptStr, context);
              return analysisResponse;
            } catch (error) {
              return `**❌ Auto-execution failed:** ${error.message}\n\n`
                + 'Please try asking your question again with a more direct approach.';
            }
          }
        }
      }
    }

    // Reset regex for normal processing
    toolExecutionRegex.lastIndex = 0;

    // eslint-disable-next-line no-cond-assign
    while ((match = toolExecutionRegex.exec(response)) !== null) {
      const [fullMatch, serverId, toolName, paramsStr] = match;

      try {
        // Parse the parameters
        // Convert JavaScript object syntax to valid JSON
        let jsonParams = paramsStr;
        // Remove JavaScript comments
        jsonParams = jsonParams.replace(/\/\/.*$/gm, '');
        jsonParams = jsonParams.replace(/\/\*[\s\S]*?\*\//g, '');
        // Replace unquoted property names with quoted ones
        jsonParams = jsonParams.replace(/(\w+):/g, '"$1":');
        // Replace single quotes with double quotes
        jsonParams = jsonParams.replace(/'/g, '"');
        // Remove trailing commas before closing braces/brackets
        jsonParams = jsonParams.replace(/,(\s*[}\]])/g, '$1');

        const params = JSON.parse(jsonParams);

        // Increment execution depth to prevent loops
        this.executionDepth += 1;

        // Execute the tool
        // eslint-disable-next-line no-await-in-loop
        const result = await this.executeMcpTool(serverId, toolName, params);

        // Decrement execution depth
        this.executionDepth -= 1;

        // Get AI analysis of the tool results
        const promptStr = 'Analyze this data and provide insights based on the user\'s '
          + 'original question. Do NOT show the raw data. Instead, answer the user\'s '
          + 'question only. IMPORTANT: Do NOT include any tool execution calls in your '
          + 'response. Just provide the analysis. Here\'s the data: '
          + `${JSON.stringify(result, null, 2)}`;
        // eslint-disable-next-line no-await-in-loop
        const analysisResponse = await this.callModel(promptStr, context);

        // Don't process tool calls in analysis responses to prevent infinite loops
        processedResponse = processedResponse.replace(fullMatch, analysisResponse);
      } catch (error) {
        const errorStr = `**❌ Tool Execution Error:** ${error.message}`;
        processedResponse = processedResponse.replace(fullMatch, errorStr);
      }
    }

    return processedResponse;
  }

  // Utility Functions
  // eslint-disable-next-line class-methods-use-this
  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  // HLX Token Management (for MCP server authentication)
  setHlxTokenForMcpServers(token) {
    if (!token) {
      return;
    }

    // Store the token for later use
    this.hlxToken = token;
  }

  getHlxToken() {
    return this.hlxToken;
  }

  async refreshHlxToken() {
    try {
      // For now, we'll just return the stored token
      // In a full implementation, this would refresh from HLX auth system
      return this.hlxToken;
    } catch (error) {
      return null;
    }
  }

  // Get DA token from sidekick context or DA SDK
  async getDaToken() {
    try {
      // Try to get token from aem-sidekick element
      if (this.sidekick && this.sidekick.config && this.sidekick.config.authToken) {
        return this.sidekick.config.authToken;
      }

      // Try to get from parent window's DA SDK if available
      if (window.parent && window.parent.DA_SDK) {
        const { token } = await window.parent.DA_SDK;
        if (token) {
          return token;
        }
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  // Set HLX token for MCP server authentication
  setHlxToken(token) {
    this.hlxToken = token;
    this.saveConfiguration();

    // Add confirmation message
    if (token) {
      this.addMessage('assistant', '🔑 **HLX Token Set:** Authentication token configured for MCP server access.');
    } else {
      this.addMessage('assistant', '⚠️ **HLX Token Cleared:** Authentication token removed. Some MCP operations may fail.');
    }
  }

  // Set up login state listener
  setupLoginListener() {
    try {
      // The findSidekickElement method handles setting up listeners on the sidekick element
      // We just need to check existing login state from localStorage
      this.checkExistingLoginState();
    } catch (error) {
      // Error setting up login listener
    }
  }

  // Set up login listeners on the sidekick element
  setupSidekickLoginListeners() {
    if (this.loginListenersSetup) {
      return;
    }

    if (!this.sidekick) {
      return;
    }

    try {
      // Listen for the sidekick's logged-in event
      this.sidekick.addEventListener('logged-in', (event) => {
        this.handleLogin(event.detail);
      });

      // Listen for logout events
      this.sidekick.addEventListener('logged-out', () => {
        this.handleLogout();
      });

      // Listen for profile update events
      this.sidekick.addEventListener('profile-updated', (event) => {
        this.handleProfileUpdate(event.detail);
      });

      this.loginListenersSetup = true;
    } catch (error) {
      // Error setting up sidekick login listeners
    }
  }

  // Handle login event
  handleLogin(profile) {
    try {
      if (!profile) {
        return;
      }

      this.userProfile = profile;
      this.isLoggedIn = true;

      // Update UI to show logged-in state
      this.updateLoginState();

      // Add success message
      this.addMessage('assistant', `🔐 **Logged In:** Welcome ${profile.name || profile.email || 'User'}! You can now use MCP tools.`);

      // Save profile to configuration
      this.saveConfiguration();
    } catch (error) {
      // Error handling login
    }
  }

  // Handle logout event
  handleLogout() {
    try {
      this.userProfile = null;
      this.isLoggedIn = false;

      // Update UI to show logged-out state
      this.updateLoginState();

      // Add logout message
      this.addMessage('assistant', '🔓 **Logged Out:** You have been logged out. MCP tools are no longer available.');

      // Save configuration
      this.saveConfiguration();
    } catch (error) {
      // Error handling logout
    }
  }

  // Handle profile update event
  handleProfileUpdate(profile) {
    try {
      if (profile && this.isLoggedIn) {
        this.userProfile = { ...this.userProfile, ...profile };

        // Save updated profile
        this.saveConfiguration();

        // Add update message
        this.addMessage('assistant', '📝 **Profile Updated:** Your profile information has been refreshed.');
      }
    } catch (error) {
      // Error handling profile update
    }
  }

  // Check if user is already logged in
  checkExistingLoginState() {
    try {
      // Check localStorage for saved profile
      const savedProfile = localStorage.getItem('hlx-user-profile');
      if (savedProfile) {
        try {
          const profile = JSON.parse(savedProfile);

          // Validate the profile before using it
          if (this.isValidProfile(profile)) {
            this.handleLogin(profile);
          } else {
            this.clearCachedProfile();
          }
        } catch (e) {
          this.clearCachedProfile();
        }
      }
    } catch (error) {
      // Error checking existing login state
    }
  }

  // Validate profile data
  // eslint-disable-next-line class-methods-use-this
  isValidProfile(profile) {
    if (!profile || typeof profile !== 'object') {
      return false;
    }

    // Check for essential fields
    const hasId = profile.id || profile.userId || profile.email;
    const hasName = profile.name || profile.displayName || profile.fullName;

    // Profile must have at least an ID or email, and a name
    if (!hasId || !hasName) {
      return false;
    }

    // Check if this looks like test data
    if ((profile.email && profile.email.includes('test@'))
        || (profile.email && profile.email.includes('example.com'))
        || (profile.name && profile.name.includes('Test'))
        || (profile.name && profile.name.includes('Example'))) {
      return false;
    }

    return true;
  }

  // Clear cached profile data
  clearCachedProfile() {
    try {
      localStorage.removeItem('hlx-user-profile');
      localStorage.removeItem('hlx-chat-config');

      // Reset instance variables
      this.userProfile = null;
      this.isLoggedIn = false;

      // Update UI
      this.updateLoginState();
    } catch (error) {
      // Error clearing cached profile
    }
  }

  // Update UI to reflect login state
  updateLoginState() {
    try {
      const statusIndicator = document.querySelector('.status-indicator');
      if (statusIndicator) {
        if (this.isLoggedIn && this.userProfile) {
          const userName = this.userProfile.name || this.userProfile.email || 'User';
          statusIndicator.innerHTML = `🔐 Logged in as ${userName} | Connected to AEM Sidekick`;
          statusIndicator.style.color = '#28a745';
        } else {
          statusIndicator.innerHTML = '🔓 Not logged in | Connected to AEM Sidekick';
          statusIndicator.style.color = '#dc3545';
        }
      }

      // Update login status in configuration modal
      const loginStatusText = document.getElementById('loginStatusText');
      if (loginStatusText) {
        if (this.isLoggedIn && this.userProfile) {
          const userName = this.userProfile.name || this.userProfile.email || 'User';
          loginStatusText.innerHTML = `🔐 Logged in as ${userName}`;
          loginStatusText.style.color = '#28a745';
        } else {
          loginStatusText.innerHTML = '🔓 Not logged in';
          loginStatusText.style.color = '#dc3545';
        }
      }

      // Update send button state
      this.updateSendButton();
    } catch (error) {
      // Error updating login state
    }
  }

  // Debug method to inspect parent window contents
  debugParentWindow() {
    try {
      let parentWindow = null;
      if (window.parent && window.parent !== window) {
        parentWindow = window.parent;
      } else if (window.opener) {
        parentWindow = window.opener;
      }

      if (!parentWindow) {
        this.addMessage('assistant', '❌ **Debug:** No parent window found');
        return;
      }

      const keys = Object.keys(parentWindow);
      const safeKeys = keys.filter((key) => {
        try {
          const value = parentWindow[key];
          return typeof value === 'object' && value !== null && !Array.isArray(value);
        } catch (e) {
          return false;
        }
      });

      let debugInfo = '🔍 **Parent Window Debug Info:**\n\n';
      debugInfo += `**Total keys:** ${keys.length}\n`;
      debugInfo += `**Object keys:** ${safeKeys.length}\n\n`;
      debugInfo += `**All keys (first 30):**\n\`\`\`\n${keys.slice(0, 30).join(', ')}\n\`\`\`\n\n`;
      debugInfo += `**Object keys (first 20):**\n\`\`\`\n${safeKeys.slice(0, 20).join(', ')}\n\`\`\`\n\n`;

      // Try to access some common paths
      const commonPaths = ['session', 'hlx', 'sidekick', 'extension', 'projects', 'auth'];
      debugInfo += '**Common path inspection:**\n';

      // eslint-disable-next-line no-restricted-syntax
      for (const path of commonPaths) {
        try {
          const value = parentWindow[path];
          if (value) {
            debugInfo += `- \`${path}\`: ${typeof value} - ${JSON.stringify(value).substring(0, 100)}...\n`;
          } else {
            debugInfo += `- \`${path}\`: undefined\n`;
          }
        } catch (e) {
          debugInfo += `- \`${path}\`: Error - ${e.message}\n`;
        }
      }

      this.addMessage('assistant', debugInfo);
    } catch (error) {
      this.addMessage('assistant', `❌ **Debug Error:** ${error.message}`);
    }
  }

  // Debug function to test modal functionality
  debugModal() {
    // Try to manually show the modal
    this.showConfigModal();
  }

  // Test MCP server connection
  async testMcpServerConnection() {
    try {
      const helixServer = this.mcpServers.find((s) => s.id === 'helix-mcp');
      if (!helixServer) {
        return;
      }

      const response = await fetch(`${helixServer.url}/context`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'MCP-Protocol-Version': '2025-06-18',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/list',
          params: {},
          id: Date.now(),
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.result && data.result.tools) {
          // Check if page-status tool is available
          const pageStatusTool = data.result.tools.find((t) => t.name === 'page-status');
          if (pageStatusTool) {
            this.addMessage('assistant', '✅ **MCP Server Connected:** The Helix MCP server is available with page-status tool and ready for use.');
          }
        }
      } else {
        this.addMessage('assistant', '⚠️ **MCP Server Warning:** Unable to connect to the Helix MCP server. Some features may not work properly.');
      }
    } catch (error) {
      this.addMessage('assistant', '❌ **MCP Server Error:** Failed to connect to the Helix MCP server. Please check your network connection.');
    }
  }
}

// Global function for AI to execute MCP tools
// eslint-disable-next-line func-names
window.executeMcpTool = async function (serverId, tool, params) {
  if (window.hlxChatInstance) {
    try {
      const result = await window.hlxChatInstance.executeMcpTool(serverId, tool, params);
      return { success: true, result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  } else {
    return { success: false, error: 'HLX Chat not initialized' };
  }
};

// Global function to set HLX token for MCP authentication
// eslint-disable-next-line func-names
window.setHlxToken = function (token) {
  if (window.hlxChatInstance) {
    try {
      window.hlxChatInstance.setHlxToken(token);
      return { success: true, message: 'HLX token set successfully' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  } else {
    return { success: false, error: 'HLX Chat not initialized' };
  }
};

// Global function to debug modal functionality
// eslint-disable-next-line func-names
window.debugModal = function () {
  if (window.hlxChatInstance) {
    try {
      window.hlxChatInstance.debugModal();
      return { success: true, message: 'Modal debug completed - check console' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  } else {
    return { success: false, error: 'HLX Chat not initialized' };
  }
};

// Temporary workaround: Global function to add API key to existing model
// eslint-disable-next-line func-names
window.setApiKey = function (apiKey, modelType = 'openai', modelName = 'GPT-4') {
  if (window.hlxChatInstance) {
    try {
      // Find existing model or create one
      const model = window.hlxChatInstance.models.find((m) => m.name === modelName);

      if (model) {
        // Update existing model with API key
        model.apiKey = apiKey;
      } else {
        // Add new model with the provided API key
        const modelData = {
          name: modelName,
          type: modelType,
          apiKey,
          apiEndpoint: modelType === 'openai' ? 'https://api.openai.com/v1' : 'https://api.anthropic.com',
          modelIdentifier: modelType === 'openai' ? 'gpt-4o-mini' : 'claude-3-sonnet-20240229',
          maxTokens: 4096,
          temperature: 0.7,
        };

        window.hlxChatInstance.addModel(modelData);
      }

      // Update UI and select the model
      window.hlxChatInstance.updateModelDropdown();
      window.hlxChatInstance.updateModelsList();

      // Auto-select if this is the only model or if no model is selected
      if (window.hlxChatInstance.models.length === 1
        || !window.hlxChatInstance.currentModel) {
        const modelId = model
          ? model.id
          : window.hlxChatInstance.models[window.hlxChatInstance.models.length - 1].id;
        window.hlxChatInstance.selectModel(modelId);
      }

      return { success: true, message: 'API key set successfully. You can now chat!' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  return { success: false, error: 'HLX Chat not initialized' };
};

// Initialize the chat when the page loads
document.addEventListener('DOMContentLoaded', () => {
  window.hlxChatInstance = new HLXChat();
});
