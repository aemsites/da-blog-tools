/* eslint-disable no-console, class-methods-use-this, no-await-in-loop, no-restricted-syntax, no-cond-assign, no-return-await, max-len, no-alert, func-names */
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

    this.daToken = null; // Store DA SDK token

    // Pre-configured Helix MCP server URL - change this in one place
    // this.HELIX_MCP_URL = 'http://localhost:3003';
    this.HELIX_MCP_URL = 'https://helix-mcp-server.aem-poc-lab.workers.dev';

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
      // eslint-disable-next-line no-console
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

      // Ensure Helix MCP server is always present and up-to-date
      const helixServerIndex = this.mcpServers.findIndex((s) => s.id === 'helix-mcp');
      if (helixServerIndex === -1) {
        // Add Helix MCP server if not present
        this.mcpServers.unshift({
          id: 'helix-mcp',
          name: 'Helix MCP',
          transport: 'http',
          url: this.HELIX_MCP_URL,
          auth: '',
          description: 'Pre-configured Helix MCP server for AEM operations',
          readonly: true,
        });
      } else {
        // Update existing Helix MCP server URL to current value
        this.mcpServers[helixServerIndex].url = this.HELIX_MCP_URL;
      }
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
          temperature: 0.7,
        },
        {
          id: 'azure-gpt-4',
          name: 'Azure GPT-4',
          type: 'openai',
          apiKey: '',
          apiEndpoint: 'https://your-resource.openai.azure.com',
          modelIdentifier: 'your-deployment-name',
          maxTokens: 4096,
          temperature: 0.7,
        },
        {
          id: 'claude-3',
          name: 'Claude 3 Sonnet',
          type: 'anthropic',
          apiKey: '',
          apiEndpoint: 'https://api.anthropic.com',
          modelIdentifier: 'claude-3-sonnet-20240229',
          maxTokens: 4096,
          temperature: 0.7,
        },
      ];
      this.mcpServers = [
        {
          id: 'helix-mcp',
          name: 'Helix MCP',
          transport: 'http',
          url: this.HELIX_MCP_URL,
          auth: '',
          description: 'Pre-configured Helix MCP server for AEM operations',
          readonly: true, // Mark as read-only
        },
        {
          id: 'filesystem',
          name: 'File System',
          transport: 'http',
          url: 'http://localhost:3001',
          auth: '',
          description: 'Access to local file system',
        },
      ];
    }
  }

  saveConfiguration() {
    const config = {
      models: this.models,
      mcpServers: this.mcpServers,
    };
    localStorage.setItem('da-chat-config', JSON.stringify(config));
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
    this.currentModel = this.models.find((m) => m.id === modelId);
    this.updateSendButton();

    if (this.currentModel) {
      this.addMessage('assistant', `Connected to ${this.currentModel.name}. Ready to chat!`);
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
      console.warn('Cannot delete pre-configured server:', server.name);
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
      console.warn('Cannot edit pre-configured server:', server.name);
      return;
    }

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
    document.getElementById('mcpUrl').value = server.url || '';
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
      // Add current user message to context for tool analysis
      context.userMessage = message;

      // Send to model
      const response = await this.callModel(message, context);

      // eslint-disable-next-line no-console
      console.log('AI Response before tool processing:', response);

      // Check if response contains tool execution requests
      const finalResponse = await this.processToolExecutions(response, context);

      // eslint-disable-next-line no-console
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
      mcpServers: this.mcpServers,
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
    // eslint-disable-next-line no-console
    console.log('Getting MCP context for servers:', this.mcpServers.map((s) => s.name));

    for (const server of this.mcpServers) {
      try {
        // eslint-disable-next-line no-console
        console.log(`Processing server: ${server.name} (Streamable HTTP)`);

        // Handle Streamable HTTP transport
        const contextResponse = await fetch(`${server.url}/context`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            'MCP-Protocol-Version': '2025-06-18',
            ...(server.auth && { Authorization: server.auth }),
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'initialize',
            params: {
              protocolVersion: '2025-06-18',
              capabilities: {
                tools: {},
                resources: {},
              },
              clientInfo: {
                name: 'da-chat',
                version: '1.0.0',
              },
            },
            id: 1,
          }),
        });

        if (contextResponse.ok) {
          // Handle SSE response
          if (contextResponse.headers.get('content-type')?.includes('text/event-stream')) {
            const reader = contextResponse.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  const data = line.slice(6);
                  if (data.trim()) {
                    try {
                      const parsed = JSON.parse(data);
                      if (parsed.result) {
                        context[server.id] = parsed.result;
                      }
                    } catch (e) {
                      console.warn('Failed to parse SSE data:', e);
                    }
                  }
                }
              }
            }
          } else {
            // Handle regular JSON response
            const data = await contextResponse.json();
            if (data.result) {
              context[server.id] = data.result;
            }
          }
        }

        // Get available tools
        const toolsResponse = await fetch(`${server.url}/context`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            'MCP-Protocol-Version': '2025-06-18',
            ...(server.auth && { Authorization: server.auth }),
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'tools/list',
            params: {},
            id: 2,
          }),
        });

        if (toolsResponse.ok) {
          // Handle SSE response
          if (toolsResponse.headers.get('content-type')?.includes('text/event-stream')) {
            const reader = toolsResponse.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  const data = line.slice(6);
                  if (data.trim()) {
                    try {
                      const parsed = JSON.parse(data);
                      if (parsed.result) {
                        context[`${server.id}_tools`] = parsed.result;
                      }
                    } catch (e) {
                      console.warn('Failed to parse SSE data:', e);
                    }
                  }
                }
              }
            }
          } else {
            // Handle regular JSON response
            const data = await toolsResponse.json();
            if (data.result) {
              context[`${server.id}_tools`] = data.result;
            }
          }
        }
      } catch (error) {
        console.warn(`Failed to get context from ${server.name}:`, error);
      }
    }

    // eslint-disable-next-line no-console
    console.log('Final MCP context:', context);
    return context;
  }

  async executeMcpTool(serverId, tool, params) {
    const server = this.mcpServers.find((s) => s.id === serverId);
    if (!server) {
      const availableServers = this.mcpServers.map((s) => s.id).join(', ');
      throw new Error(`MCP server '${serverId}' not found. Available servers: ${availableServers}`);
    }

    // Refresh DA token before making request
    await this.refreshDaToken();

    // Add DA token as helixAdminApiToken if available
    const paramsWithToken = { ...params };
    if (this.daToken) {
      paramsWithToken.helixAdminApiToken = this.daToken;
    }

    // Execute Streamable HTTP MCP tool
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

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data.trim()) {
              try {
                const parsed = JSON.parse(data);
                if (parsed.result) {
                  return parsed.result;
                } if (parsed.error) {
                  throw new Error(parsed.error.message || parsed.error);
                }
              } catch (e) {
                console.warn('Failed to parse SSE data:', e);
              }
            }
          }
        }
      }
      throw new Error('No valid response received from SSE stream');
    } else {
      // Handle regular JSON response
      const data = await response.json();
      if (data.result) {
        return data.result;
      } if (data.error) {
        throw new Error(data.error.message || data.error);
      }
      throw new Error('Invalid response format');
    }
  }

  async processToolExecutions(response, context) {
    // Look for tool execution patterns in the AI response
    const toolExecutionRegex = /^window\.executeMcpTool\(['"]([^'"]+)['"],\s*['"]([^'"]+)['"],\s*(\{[^}]*\})\);?$/gm;

    // Also look for tool execution patterns inside code blocks
    const codeBlockRegex = /```(?:javascript|js)?\s*\n?window\.executeMcpTool\(['"]([^'"]+)['"],\s*['"]([^'"]+)['"],\s*(\{[^}]*\})\);?\s*\n?```/g;

    // Look for environment variable function calls
    const setEnvVarRegex = /window\.setMcpEnvVar\(['"]([^'"]+)['"],\s*['"]([^'"]+)['"],\s*['"]([^'"]+)['"]\);?/g;
    const getEnvVarsRegex = /window\.getMcpEnvVars\(['"]([^'"]+)['"]\);?/g;

    let match;
    let processedResponse = response;

    // eslint-disable-next-line no-console
    console.log('Processing response for tool executions:', response);

    // Clean up any leftover markdown code blocks or javascript references
    processedResponse = processedResponse.replace(/```javascript\s*\n?/g, '');
    processedResponse = processedResponse.replace(/```\s*\n?/g, '');
    processedResponse = processedResponse.replace(/javascript\s*$/gm, '');

    // Auto-correct any remaining double window references in the response
    processedResponse = processedResponse.replace(/window\.window\.executeMcpTool/g, 'window.executeMcpTool');

    // First try the strict pattern
    while ((match = toolExecutionRegex.exec(response)) !== null) {
      const [fullMatch, serverId, toolName, paramsStr] = match;

      // Auto-correct double window calls
      if (fullMatch.includes('window.window')) {
        console.log('Auto-correcting double window call:', fullMatch);
        const correctedCall = fullMatch.replace('window.window.executeMcpTool', 'window.executeMcpTool');
        processedResponse = processedResponse.replace(fullMatch, correctedCall);
        // Update the match for processing
        match[0] = correctedCall;
        // Also correct the fullMatch for display
        fullMatch = correctedCall;
      }

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

        // Check if this is a stub response and try alternatives
        const resultData = this.extractResultData(result);
        const resultStr = JSON.stringify(resultData);

        if (resultStr.includes('Tool \'') && resultStr.includes('called with arguments')) {
          console.log('Detected stub response, trying alternative approach');
          const finalMessage = `<p><strong>🔍 Data Source Issue:</strong> The ${toolName} tool returned a placeholder response instead of actual data.</p>
                             <p>This suggests the MCP server may be in development mode or the requested data is not available.</p>
                             <p>To get the last 3 previewed pages, you might need to check:</p>
                             <ul>
                               <li>Helix admin interface directly</li>
                               <li>Browser developer tools for recent requests</li>
                               <li>Local storage or session data</li>
                             </ul>`;
          processedResponse = processedResponse.replace(fullMatch, finalMessage);
        } else {
          // Real data - analyze normally
          console.log('Got real data, analyzing...');
          const analysisPrompt = `The user asked: "${context.userMessage || 'for information'}"
          
Tool executed: ${toolName}
Result: ${JSON.stringify(resultData, null, 2)}

Analyze this data and answer the user's question. Provide your response as clean HTML with proper semantic structure. Use <h3> for section headers, <ul> and <li> for lists, <strong> for emphasis, and <p> for paragraphs. Do NOT use markdown or code blocks.`;

          const analysisResponse = await this.callModel(analysisPrompt, context);
          console.log('Analysis response:', analysisResponse);
          processedResponse = processedResponse.replace(fullMatch, analysisResponse);
        }
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

        // Check if this is a stub response and try alternatives
        const resultData = this.extractResultData(result);
        const resultStr = JSON.stringify(resultData);

        if (resultStr.includes('Tool \'') && resultStr.includes('called with arguments')) {
          console.log('Detected stub response (code block), trying alternative approach');
          const finalMessage = `<p><strong>🔍 Data Source Issue:</strong> The ${toolName} tool returned a placeholder response instead of actual data.</p>
                             <p>This suggests the MCP server may be in development mode or the requested data is not available.</p>
                             <p>To get the last 3 previewed pages, you might need to check:</p>
                             <ul>
                               <li>Helix admin interface directly</li>
                               <li>Browser developer tools for recent requests</li>
                               <li>Local storage or session data</li>
                             </ul>`;
          processedResponse = processedResponse.replace(fullMatch, finalMessage);
        } else {
          // Real data - analyze normally
          console.log('Got real data (code block), analyzing...');
          const analysisPrompt = `The user asked: "${context.userMessage || 'for information'}"
          
Tool executed: ${toolName}
Result: ${JSON.stringify(resultData, null, 2)}

Analyze this data and answer the user's question. Provide your response as clean HTML with proper semantic structure. Use <h3> for section headers, <ul> and <li> for lists, <strong> for emphasis, and <p> for paragraphs. Do NOT use markdown or code blocks.`;

          const analysisResponse = await this.callModel(analysisPrompt, context);
          console.log('Analysis response:', analysisResponse);
          processedResponse = processedResponse.replace(fullMatch, analysisResponse);
        }
      } catch (error) {
        console.error(`Failed to execute tool ${toolName}:`, error);
        const errorStr = `**❌ Tool Execution Error:** ${error.message}`;
        processedResponse = processedResponse.replace(fullMatch, errorStr);
      }
    }

    // Also look for simpler patterns like: executeMcpTool('serverId', 'toolName', {params})
    const simplePattern = /executeMcpTool\(['"]([^'"]+)['"],\s*['"]([^'"]+)['"],\s*(\{[^}]*\})\);?/g;
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

        // Check if this is a stub response and try alternatives
        const resultData = this.extractResultData(result);
        const resultStr = JSON.stringify(resultData);

        if (resultStr.includes('Tool \'') && resultStr.includes('called with arguments')) {
          console.log('Detected stub response (simple pattern), trying alternative approach');
          const finalMessage = `<p><strong>🔍 Data Source Issue:</strong> The ${toolName} tool returned a placeholder response instead of actual data.</p>
                             <p>This suggests the MCP server may be in development mode or the requested data is not available.</p>
                             <p>To get the last 3 previewed pages, you might need to check:</p>
                             <ul>
                               <li>Helix admin interface directly</li>
                               <li>Browser developer tools for recent requests</li>
                               <li>Local storage or session data</li>
                             </ul>`;
          processedResponse = processedResponse.replace(fullMatch, finalMessage);
        } else {
          // Real data - analyze normally
          console.log('Got real data (simple pattern), analyzing...');
          const analysisPrompt = `The user asked: "${context.userMessage || 'for information'}"
          
Tool executed: ${toolName}
Result: ${JSON.stringify(resultData, null, 2)}

Analyze this data and answer the user's question. Provide your response as clean HTML with proper semantic structure. Use <h3> for section headers, <ul> and <li> for lists, <strong> for emphasis, and <p> for paragraphs. Do NOT use markdown or code blocks.`;

          const analysisResponse = await this.callModel(analysisPrompt, context);
          console.log('Analysis response:', analysisResponse);
          processedResponse = processedResponse.replace(fullMatch, analysisResponse);
        }
      } catch (error) {
        console.error(`Failed to execute tool ${toolName}:`, error);
        const errorStr = `**❌ Tool Execution Error:** ${error.message}`;
        processedResponse = processedResponse.replace(fullMatch, errorStr);
      }
    }

    // Process setMcpEnvVar calls
    while ((match = setEnvVarRegex.exec(processedResponse)) !== null) {
      const [fullMatch, serverId, varName, varValue] = match;

      try {
        console.log(`Setting environment variable: ${varName} = ${varValue} for server ${serverId}`);
        this.setMcpEnvVar(serverId, varName, varValue);
        processedResponse = processedResponse.replace(fullMatch, `✅ Environment variable ${varName} set to ${varValue} for server ${serverId}`);
      } catch (error) {
        console.error(`Failed to set environment variable ${varName}:`, error);
        processedResponse = processedResponse.replace(fullMatch, `❌ Failed to set environment variable: ${error.message}`);
      }
    }

    // Process getMcpEnvVars calls
    while ((match = getEnvVarsRegex.exec(processedResponse)) !== null) {
      const [fullMatch, serverId] = match;

      try {
        console.log(`Getting environment variables for server: ${serverId}`);
        const envVars = this.getMcpEnvVars(serverId);
        const envVarsStr = JSON.stringify(envVars, null, 2);
        processedResponse = processedResponse.replace(fullMatch, `**Environment Variables for ${serverId}:**\n\`\`\`json\n${envVarsStr}\n\`\`\``);
      } catch (error) {
        console.error(`Failed to get environment variables for ${serverId}:`, error);
        processedResponse = processedResponse.replace(fullMatch, `❌ Failed to get environment variables: ${error.message}`);
      }
    }

    // Final cleanup: remove any remaining markdown artifacts
    processedResponse = processedResponse.replace(/```javascript\s*\n?/g, '');
    processedResponse = processedResponse.replace(/```\s*\n?/g, '');
    processedResponse = processedResponse.replace(/javascript\s*$/gm, '');
    processedResponse = processedResponse.replace(/^\s*```\s*$/gm, '');
    processedResponse = processedResponse.replace(/^\s*`\s*$/gm, '');

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
    const dateInfo = this.getCurrentDateInfo();
    const availableServerIds = this.mcpServers.map((s) => s.id).join(', ');
    const firstServerId = this.mcpServers.length > 0 ? this.mcpServers[0].id : 'your-server-id';
    const criticalInstruction = `\n\nDIRECT EXECUTION: When users ask for actions, respond with ONLY the tool call: window.executeMcpTool(serverId, toolName, params)\n\nAVAILABLE SERVER IDS: ${availableServerIds}\n\nTOOL USAGE:\n- audit-log: {org, site, since/from/to}\n- page-status: {org, site, path}\n- start-bulk-page-status: {org, site}\n- check-bulk-page-status: {jobId}\n- rum-data: {url, domainkey, aggregation, startdate, enddate}\n\nCURRENT DATE INFO: Today is ${dateInfo.today}, 7 days ago was ${dateInfo.sevenDaysAgo}, 30 days ago was ${dateInfo.thirtyDaysAgo}.\n\nCRITICAL RULES:\n- NO explanatory text like "I will execute" or "Let me check"\n- NO descriptions of what you will do\n- Execute tools immediately with window.executeMcpTool()\n- Present data only, no analysis unless requested\n- No "Key Insights" or "Recommendations" sections`;

    let endpoint; let
      headers;

    if (isAzure) {
      // Azure OpenAI format: https://{resource-name}.openai.azure.com/openai/deployments/{deployment-name}/chat/completions?api-version=2024-02-15-preview
      const deploymentName = model.modelIdentifier; // In Azure, modelIdentifier should be the deployment name
      endpoint = `${model.apiEndpoint}/openai/deployments/${deploymentName}/chat/completions?api-version=2024-02-15-preview`;
      headers = {
        'Content-Type': 'application/json',
        'api-key': model.apiKey, // Azure uses api-key header instead of Authorization
      };
    } else {
      // Standard OpenAI format
      endpoint = `${model.apiEndpoint}/chat/completions`;
      headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${model.apiKey}`,
      };
    }

    // Prepare system message with MCP context
    let systemMessage = 'You are a helpful AI assistant.';

    if (context.mcpServers && context.mcpServers.length > 0) {
      systemMessage += '\n\nYou have access to the following MCP (Model Context Protocol) servers:\n';

      context.mcpServers.forEach((server) => {
        systemMessage += `- ${server.name}: ${server.description || 'No description'}\n`;
      });

      if (context.mcpData) {
        console.log('MCP Data being sent to AI:', context.mcpData);
        systemMessage += '\n\n=== AVAILABLE MCP TOOLS AND CAPABILITIES ===\n';
        Object.keys(context.mcpData).forEach((serverId) => {
          const data = context.mcpData[serverId];
          if (data && typeof data === 'object') {
            systemMessage += `\n${serverId} server:\n`;
            systemMessage += `- Status: ${data.status || 'unknown'}\n`;
            systemMessage += `- Transport: ${data.transport || 'unknown'}\n`;

            if (data.tools && Array.isArray(data.tools) && data.tools.length > 0) {
              systemMessage += `- Available Tools (${data.tools.length}):\n`;
              data.tools.forEach((tool) => {
                systemMessage += `  * ${tool.name}: ${tool.title || tool.description || 'No description'}\n`;
              });
            } else {
              systemMessage += '- Available Tools: None found\n';
            }

            if (data.resources && Array.isArray(data.resources) && data.resources.length > 0) {
              systemMessage += `- Available Resources (${data.resources.length}):\n`;
              data.resources.forEach((resource) => {
                systemMessage += `  * ${resource.name}: ${resource.title || resource.description || 'No description'}\n`;
              });
            }

            if (data.error) {
              systemMessage += `- Error: ${data.error}\n`;
            }
          }
        });

        systemMessage += '\n=== INSTRUCTIONS ===\n';
        systemMessage += 'You have access to the above MCP tools and can use them to help users. ';
        systemMessage += 'When users ask about system information, files, or need to perform actions, ';
        systemMessage += 'you can leverage these tools to provide accurate and helpful responses.\n\n';
        systemMessage += 'TO EXECUTE TOOLS: You can execute tools by calling the global function:\n';
        systemMessage += 'window.executeMcpTool(serverId, toolName, parameters)\n\n';
        systemMessage += `AVAILABLE SERVER IDS: ${this.mcpServers.map((s) => s.id).join(', ')}\n\n`;
        systemMessage += 'For example:\n';
        const exampleServerId = this.mcpServers.length > 0 ? this.mcpServers[0].id : 'your-server-id';
        systemMessage += `- To list files: window.executeMcpTool('${exampleServerId}', 'list_files', {path: '/'})\n`;
        systemMessage += `- To read a file: window.executeMcpTool('${exampleServerId}', 'read_file', {path: '/path/to/file'})\n\n`;
        systemMessage += 'ENVIRONMENT VARIABLES: You can manage environment variables using:\n';
        systemMessage += '- window.setMcpEnvVar(serverId, varName, varValue) - Set an environment variable\n';
        systemMessage += '- window.getMcpEnvVars(serverId) - Get current environment variables\n\n';
        systemMessage += 'When users request specific actions, actually execute the appropriate tools and show the results.\n';
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
          ...this.chatHistory.map((msg) => ({
            role: msg.role,
            content: msg.content,
          })),
          { role: 'user', content: message },
        ],
        max_tokens: model.maxTokens,
        temperature: model.temperature,
      }),
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
    let systemMessage = 'You are a helpful AI assistant.';

    if (context.mcpServers && context.mcpServers.length > 0) {
      systemMessage += '\n\nYou have access to the following MCP (Model Context Protocol) servers:\n';

      context.mcpServers.forEach((server) => {
        systemMessage += `- ${server.name}: ${server.description || 'No description'}\n`;
      });

      if (context.mcpData) {
        console.log('MCP Data being sent to AI:', context.mcpData);
        systemMessage += '\n\n=== AVAILABLE MCP TOOLS AND CAPABILITIES ===\n';
        Object.keys(context.mcpData).forEach((serverId) => {
          const data = context.mcpData[serverId];
          if (data && typeof data === 'object') {
            systemMessage += `\n${serverId} server:\n`;
            systemMessage += `- Status: ${data.status || 'unknown'}\n`;
            systemMessage += `- Transport: ${data.transport || 'unknown'}\n`;

            if (data.tools && Array.isArray(data.tools) && data.tools.length > 0) {
              systemMessage += `- Available Tools (${data.tools.length}):\n`;
              data.tools.forEach((tool) => {
                systemMessage += `  * ${tool.name}: ${tool.title || tool.description || 'No description'}\n`;
              });
            } else {
              systemMessage += '- Available Tools: None found\n';
            }

            if (data.resources && Array.isArray(data.resources) && data.resources.length > 0) {
              systemMessage += `- Available Resources (${data.resources.length}):\n`;
              data.resources.forEach((resource) => {
                systemMessage += `  * ${resource.name}: ${resource.title || resource.description || 'No description'}\n`;
              });
            }

            if (data.error) {
              systemMessage += `- Error: ${data.error}\n`;
            }
          }
        });

        systemMessage += '\n=== INSTRUCTIONS ===\n';
        systemMessage += 'You have access to the above MCP tools and can use them to help users. ';
        systemMessage += 'When users ask about system information, files, or need to perform actions, ';
        systemMessage += 'you can leverage these tools to provide accurate and helpful responses.\n\n';
        systemMessage += 'TO EXECUTE TOOLS: You can execute tools by calling the global function:\n';
        systemMessage += 'window.executeMcpTool(serverId, toolName, parameters)\n\n';
        systemMessage += `AVAILABLE SERVER IDS: ${this.mcpServers.map((s) => s.id).join(', ')}\n\n`;
        systemMessage += 'For example:\n';
        const exampleServerId = this.mcpServers.length > 0 ? this.mcpServers[0].id : 'your-server-id';
        systemMessage += `- To list files: window.executeMcpTool('${exampleServerId}', 'list_files', {path: '/'})\n`;
        systemMessage += `- To read a file: window.executeMcpTool('${exampleServerId}', 'read_file', {path: '/path/to/file'})\n\n`;
        systemMessage += 'ENVIRONMENT VARIABLES: You can manage environment variables using:\n';
        systemMessage += '- window.setMcpEnvVar(serverId, varName, varValue) - Set an environment variable\n';
        systemMessage += '- window.getMcpEnvVars(serverId) - Get current environment variables\n\n';
        systemMessage += 'When users request specific actions, actually execute the appropriate tools and show the results.\n';
      }
    }

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
        system: systemMessage,
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

  async callLocalModel(message, context, model) {
    const response = await fetch(model.apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(model.apiKey && { Authorization: `Bearer ${model.apiKey}` }),
      },
      body: JSON.stringify({
        message,
        context,
        model: model.modelIdentifier,
        max_tokens: model.maxTokens,
        temperature: model.temperature,
      }),
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
        ...(model.apiKey && { Authorization: `Bearer ${model.apiKey}` }),
      },
      body: JSON.stringify({
        message,
        context,
        model: model.modelIdentifier,
        max_tokens: model.maxTokens,
        temperature: model.temperature,
      }),
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

    // Check if content already contains HTML tags (from AI analysis)
    if (content.includes('<') && content.includes('>')) {
      // Content is already HTML, just return it
      return content;
    }

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
    // Line breaks - convert to spaces for natural text flow
      .replace(/\n/g, ' ')
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

  extractResultData(result) {
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
          const textContent = data.content.find((item) => item.type === 'text');
          if (textContent && textContent.text) {
            try {
              const parsedContent = JSON.parse(textContent.text);
              return parsedContent;
            } catch (e) {
              return textContent.text;
            }
          }
        }

        // Return the data as is
        return data;
      }

      return data;
    } catch (error) {
      return result;
    }
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

      console.log('formatToolResult - data type:', typeof data, 'isArray:', Array.isArray(data));
      console.log('formatToolResult - data keys:', data && typeof data === 'object' ? Object.keys(data) : 'not object');

      // Handle different result structures
      if (data && typeof data === 'object') {
        // If it has a content array with text (like the page-status result)
        if (data.content && Array.isArray(data.content)) {
          const textContent = data.content.find((item) => item.type === 'text');
          if (textContent && textContent.text) {
            try {
              const parsedContent = JSON.parse(textContent.text);
              console.log('Parsed content type:', typeof parsedContent, 'isArray:', Array.isArray(parsedContent));

              // Check if this looks like page status data
              if (parsedContent.webPath || parsedContent.live || parsedContent.preview) {
                return this.formatPageStatusResult(parsedContent);
              } if (Array.isArray(parsedContent) && parsedContent.length > 0 && (parsedContent[0].url || parsedContent[0].urlL)) {
                // This looks like RUM data array
                console.log('Detected RUM data array in content');
                return this.formatRumDataResult(data);
              } if (parsedContent.aggregation || parsedContent.url) {
                // This looks like RUM data object
                return this.formatRumDataResult(data);
              }
              // Otherwise format as generic tool result
              return this.formatObjectResult(parsedContent);
            } catch (e) {
              // If parsing fails, check if the original data looks like RUM data
              if (data.content && data.content.length > 0) {
                return this.formatRumDataResult(data);
              }
              return textContent.text;
            }
          }
        }

        // Check if this is a direct array of performance data (RUM data)
        if (Array.isArray(data) && data.length > 0 && (data[0].url || data[0].urlL)) {
          console.log('Detected array of RUM data');
          return this.formatRumDataResult({ content: [{ type: 'text', text: JSON.stringify(data) }] });
        }

        // Check if this is a single performance data object (RUM data)
        if (data.url || data.urlL) {
          console.log('Detected single RUM data object');
          return this.formatRumDataResult({ content: [{ type: 'text', text: JSON.stringify([data]) }] });
        }

        // Check if this is an object with numbered keys that contain RUM data
        if (!Array.isArray(data) && typeof data === 'object') {
          const keys = Object.keys(data);
          const firstKey = keys[0];
          console.log('Checking numbered keys - firstKey:', firstKey, 'isNaN:', Number.isNaN(firstKey));
          if (firstKey && !Number.isNaN(firstKey) && data[firstKey]) {
            console.log('First item:', data[firstKey]);
            if (data[firstKey].url || data[firstKey].urlL) {
              console.log('Detected object with numbered RUM data keys');
              const rumArray = Object.values(data);
              return this.formatRumDataResult({ content: [{ type: 'text', text: JSON.stringify(rumArray) }] });
            }
          }
        }

        // Check if this looks like RUM data even without numbered keys
        if (!Array.isArray(data) && typeof data === 'object') {
          const values = Object.values(data);
          if (values.length > 0 && values[0] && typeof values[0] === 'object' && (values[0].url || values[0].urlL)) {
            console.log('Detected object with RUM data values');
            return this.formatRumDataResult({ content: [{ type: 'text', text: JSON.stringify(values) }] });
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

  formatRumDataResult(data) {
    let formatted = '\n\n**📈 RUM Data Results**\n\n';

    if (data.content && Array.isArray(data.content)) {
      const textContent = data.content.find((item) => item.type === 'text');
      if (textContent && textContent.text) {
        try {
          const rumData = JSON.parse(textContent.text);

          // Check if this is an array of performance data
          if (Array.isArray(rumData)) {
            formatted += '**📊 Performance Data:**\n\n';
            rumData.forEach((item, index) => {
              // Extract page name from URL
              const url = item.url || item.urlL || 'Unknown page';
              const pageName = url.split('/').pop() || url;

              formatted += `**${index + 1}.** \`${pageName}\`\n`;
              formatted += `   - **URL:** ${url}\n`;
              formatted += `   - **Sample Count:** ${item.count || 'N/A'}\n`;
              formatted += `   - **Total Load Time:** ${item.sum || 'N/A'}ms\n`;
              formatted += `   - **Average Load Time:** ${item.mean || 'N/A'}ms\n`;
              formatted += `   - **Median (P50):** ${item.p50 || 'N/A'}ms\n`;
              formatted += `   - **75th Percentile (P75):** ${item.p75 || 'N/A'}ms\n`;
              if (item.errorRate !== undefined) {
                formatted += `   - **Error Rate:** ${item.errorRate.toFixed(1)}%\n`;
              }
              formatted += '\n';
            });
            return formatted;
          }

          // Handle other RUM data formats
          formatted += `**Aggregation:** \`${rumData.aggregation || 'Unknown'}\`\n`;
          formatted += `**URL:** \`${rumData.url || 'Unknown'}\`\n`;
          formatted += `**Date Range:** \`${rumData.startdate || 'Unknown'} to ${rumData.enddate || 'Unknown'}\`\n\n`;

          if (rumData.data && Array.isArray(rumData.data)) {
            formatted += '**📊 Data Points:**\n\n';
            rumData.data.forEach((item, index) => {
              formatted += `**${index + 1}.** \`${item.page || item.url || 'Unknown page'}\`\n`;
              formatted += `   - **Views:** ${item.pageviews || item.views || 'N/A'}\n`;
              formatted += `   - **Visits:** ${item.visits || 'N/A'}\n`;
              if (item.avgTimeOnPage) {
                formatted += `   - **Avg Time:** ${item.avgTimeOnPage}\n`;
              }
              formatted += '\n';
            });
          } else if (rumData.summary) {
            formatted += '**📋 Summary:**\n';
            formatted += `\`\`\`json\n${JSON.stringify(rumData.summary, null, 2)}\n\`\`\`\n\n`;
          } else {
            formatted += '**📋 Raw Data:**\n';
            formatted += `\`\`\`json\n${JSON.stringify(rumData, null, 2)}\n\`\`\`\n\n`;
          }
        } catch (e) {
          // Try to parse as array of performance data
          try {
            const performanceData = JSON.parse(textContent.text);
            if (Array.isArray(performanceData)) {
              formatted += '**📊 Performance Data:**\n\n';
              performanceData.forEach((item, index) => {
                // Extract page name from URL
                const url = item.url || item.urlL || 'Unknown page';
                const pageName = url.split('/').pop() || url;

                formatted += `**${index + 1}.** \`${pageName}\`\n`;
                formatted += `   - **URL:** ${url}\n`;
                formatted += `   - **Sample Count:** ${item.count || 'N/A'}\n`;
                formatted += `   - **Total Load Time:** ${item.sum || 'N/A'}ms\n`;
                formatted += `   - **Average Load Time:** ${item.mean || 'N/A'}ms\n`;
                formatted += `   - **Median (P50):** ${item.p50 || 'N/A'}ms\n`;
                formatted += `   - **75th Percentile (P75):** ${item.p75 || 'N/A'}ms\n`;
                if (item.errorRate !== undefined) {
                  formatted += `   - **Error Rate:** ${item.errorRate.toFixed(1)}%\n`;
                }
                formatted += '\n';
              });
            } else {
              formatted += '**📋 Raw Response:**\n';
              formatted += `\`\`\`\n${textContent.text}\n\`\`\`\n\n`;
            }
          } catch (e2) {
            formatted += '**📋 Raw Response:**\n';
            formatted += `\`\`\`\n${textContent.text}\n\`\`\`\n\n`;
          }
        }
      }
    } else {
      formatted += '**📋 Raw Data:**\n';
      formatted += `\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`\n\n`;
    }

    return formatted;
  }

  getStatusBadge(status) {
    if (status === 200) {
      return '🟢 **200 OK**';
    } if (status === 404) {
      return '🔴 **404 Not Found**';
    } if (status >= 500) {
      return '🔴 **Server Error**';
    } if (status >= 400) {
      return '🟡 **Client Error**';
    }
    return `⚪ **${status}**`;
  }

  getCurrentDateInfo() {
    const now = new Date();
    const today = now.toISOString().split('T')[0]; // YYYY-MM-DD format

    // Calculate 7 days ago
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(now.getDate() - 7);
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0];

    // Calculate 30 days ago
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(now.getDate() - 30);
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

    return {
      today,
      sevenDaysAgo: sevenDaysAgoStr,
      thirtyDaysAgo: thirtyDaysAgoStr,
      currentYear: now.getFullYear(),
      currentMonth: now.getMonth() + 1,
      currentDay: now.getDate(),
    };
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
      maxTokens: parseInt(formData.get('maxTokens') || document.getElementById('maxTokens').value, 10),
      temperature: parseFloat(formData.get('temperature') || document.getElementById('temperature').value),
    };

    if (!modelData.name || !modelData.type || !modelData.apiKey) {
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
      alert('Please fill in all required fields');
      return;
    }

    // Check if URL conflicts with Helix MCP server
    if (serverData.url === this.HELIX_MCP_URL) {
      alert('Cannot add a server with the same URL as the pre-configured Helix MCP server');
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
    console.log('DA token stored for potential future use');
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

  // Environment variable management for AI
  setMcpEnvVar(serverId, varName, varValue) {
    const server = this.mcpServers.find((s) => s.id === serverId);
    if (!server) {
      throw new Error(`MCP server ${serverId} not found`);
    }

    if (!server.env) {
      server.env = {};
    }

    server.env[varName] = varValue;
    this.saveConfiguration();
    this.updateMcpServersList();

    console.log(`Set environment variable ${varName} for server ${server.name}`);
    return { success: true, message: `Set ${varName} for ${server.name}` };
  }

  getMcpEnvVars(serverId) {
    const server = this.mcpServers.find((s) => s.id === serverId);
    if (!server) {
      throw new Error(`MCP server ${serverId} not found`);
    }

    return server.env || {};
  }
}

// Global function for AI to execute MCP tools
window.executeMcpTool = async function (serverId, tool, params) {
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

// Global function for AI to set environment variables
window.setMcpEnvVar = function (serverId, varName, varValue) {
  if (window.daChatInstance) {
    try {
      const result = window.daChatInstance.setMcpEnvVar(serverId, varName, varValue);
      return { success: true, result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  } else {
    return { success: false, error: 'DA Chat not initialized' };
  }
};

// Global function for AI to get current environment variables
window.getMcpEnvVars = function (serverId) {
  if (window.daChatInstance) {
    try {
      const result = window.daChatInstance.getMcpEnvVars(serverId);
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
