# DA Chat - Configurable AI Chatbot with MCP Support

A modern, configurable chatbot that supports multiple AI models and Model Context Protocol (MCP) servers for enhanced functionality.

## Features

- **Multi-Model Support**: Configure and switch between different AI models (OpenAI, Anthropic, Local, Custom APIs)
- **MCP Server Integration**: Connect to various MCP servers for enhanced context and capabilities
- **Modern UI**: Clean, responsive interface with real-time chat experience
- **Configuration Management**: Easy setup and management of models and MCP servers
- **Chat History**: Persistent conversation history with timestamps
- **Real-time Feedback**: Loading states and error handling

## Quick Start

1. **Start the MCP Server** (if using MCP features):
   ```bash
   cd tools/plugins/da-chat
   ./setup-mcp-server.sh
   ```
   This will start the MCP server on http://localhost:3003

2. **Open DA Chat**:
   - Open `da-chat.html` in your web browser
   - Click the settings icon (⚙️) to configure your models and MCP servers
   - Add your API keys and endpoints
   - Select a model from the dropdown
   - Start chatting!

## Model Configuration

### Supported Model Types

1. **OpenAI Models** (GPT-4, GPT-3.5-turbo, etc.)
   - API Key: Your OpenAI API key
   - Endpoint: `https://api.openai.com/v1` (default)
   - Model Identifier: `gpt-4`, `gpt-3.5-turbo`, etc.

2. **Anthropic Models** (Claude 3, Claude 2, etc.)
   - API Key: Your Anthropic API key
   - Endpoint: `https://api.anthropic.com` (default)
   - Model Identifier: `claude-3-sonnet-20240229`, `claude-2.1`, etc.

3. **Local Models** (Ollama, LM Studio, etc.)
   - API Key: Optional authentication
   - Endpoint: Your local model server URL
   - Model Identifier: Model name as configured on your server

4. **Custom APIs**
   - API Key: Your custom API key
   - Endpoint: Your custom API endpoint
   - Model Identifier: Model identifier for your API

### Model Parameters

- **Max Tokens**: Maximum number of tokens in the response (1-32,000)
- **Temperature**: Controls randomness (0.0 = deterministic, 2.0 = very random)

## MCP Server Configuration

MCP (Model Context Protocol) servers provide additional context and capabilities to your chatbot.

### Example MCP Servers

1. **File System Server** (HTTP Transport)
   - Name: File System
   - Transport: HTTP
   - URL: `http://localhost:3001`
   - Description: Access to local file system



3. **GitHub Server**
   - Name: GitHub
   - URL: `http://localhost:3000/mcp/github`
   - Description: GitHub repository access

4. **Database Server**
   - Name: Database
   - URL: `http://localhost:3000/mcp/database`
   - Description: Database query capabilities

### MCP Server Setup

The included MCP server provides basic functionality for testing and development:

#### Starting the MCP Server

1. **Navigate to the da-chat directory:**
   ```bash
   cd tools/plugins/da-chat
   ```

2. **Run the setup script:**
   ```bash
   ./setup-mcp-server.sh
   ```

3. **The server will start on http://localhost:3003**

#### Available Tools

The MCP server provides these tools:
- `page-status` - Returns mock page status information
- `echo` - Echoes back a message
- `test` - Simple test tool

#### MCP Server Requirements

MCP servers should implement the following endpoints:

- `GET /context` - Returns contextual information
- `POST /tools` - Executes tools/actions
- `GET /health` - Health check endpoint




## Usage Examples

### Basic Chat

1. Select a model from the dropdown
2. Type your message in the input field
3. Press Enter or click the send button
4. View the AI response

### Using MCP Servers

When MCP servers are configured, the chatbot will automatically:
- Fetch context from connected servers
- Include relevant information in the conversation
- Provide enhanced capabilities based on server features

### Testing MCP Functionality

#### 1. Start the MCP Server
```bash
cd tools/plugins/da-chat
npm install
npm start
```

#### 2. Configure MCP Server in Chatbot
- Open the chatbot settings (⚙️)
- Add MCP Server:
  - **Name**: File System
  - **URL**: `http://localhost:3001`
  - **Description**: Access to local file system

#### 3. Test Prompts

**Basic Context Test:**
```
"What information can you access from the MCP server?"
```

**File System Operations:**
```
"List the files in the current directory"
"What files are in my project folder?"
"Search for files containing 'test'"
"Read the contents of package.json"
"Show me the file structure of this project"
```

**Advanced Operations:**
```
"Create a test file with some content"
"What are the most common file types in this directory?"
"Show me files that were recently modified"
```

#### 4. Expected Responses

The AI should respond with:
- File listings from your current directory
- File contents when requested
- Search results
- File statistics and metadata

#### 5. Debug MCP Integration

Check the browser console (F12) for:
- MCP context fetching logs
- Tool execution requests
- Error messages if MCP server is unreachable

**Example conversation with file system MCP:**
```
User: "What files are in my current directory?"
AI: "Based on the file system context, I can see the following files in your current directory: [list of files]"
```

## Configuration Storage

All configuration is stored locally in your browser's localStorage:
- Model configurations (API keys, endpoints, parameters)
- MCP server configurations
- Chat history (for the current session)

## Security Considerations

- API keys are stored locally in your browser
- Never share your configuration with others
- Use HTTPS endpoints for production use
- Consider using environment variables for sensitive data

## Troubleshooting

### Common Issues

1. **"Error: HTTP 401"**
   - Check your API key is correct
   - Verify the API key has the necessary permissions

2. **"Error: HTTP 404"**
   - Verify the API endpoint URL is correct
   - Check if the model identifier exists

3. **"Failed to get MCP context"**
   - Ensure MCP servers are running
   - Check server URLs and authentication
   - Verify CORS settings if running locally

4. **"MCP server [server-id] not found"**
   - This error occurs when the AI tries to use a server ID that doesn't exist in your configuration
   - Check your MCP server configuration in the settings
   - Available server IDs: `filesystem`, `local-test`
   - You can add custom servers with any ID you prefer
   - The AI will use the server IDs configured in your settings

5. **Model not responding**
   - Check your internet connection
   - Verify API rate limits
   - Check browser console for detailed errors

### Debug Mode

Open your browser's developer console (F12) to see detailed error messages and debug information.

## API Reference

### Model Configuration Object

```javascript
{
  id: "unique-id",
  name: "Model Name",
  type: "openai|anthropic|local|custom",
  apiKey: "your-api-key",
  apiEndpoint: "https://api.example.com",
  modelIdentifier: "model-name",
  maxTokens: 4096,
  temperature: 0.7
}
```

### MCP Server Configuration Object

```javascript
{
  id: "unique-id",
  name: "Server Name",
  url: "http://localhost:3000/mcp/server",
  auth: "optional-auth-token",
  description: "Server description"
}
```

## Contributing

To extend the chatbot:

1. **Add New Model Types**: Extend the `callModel` method in `da-chat.js`
2. **Add New MCP Features**: Implement additional MCP server endpoints
3. **UI Improvements**: Modify the CSS and HTML structure
4. **New Features**: Add new functionality to the `DAChat` class

## License

This project is part of the Adobe AEM Block Collection and follows the same licensing terms.

## Support

For issues and questions:
1. Check the troubleshooting section above
2. Review browser console for error messages
3. Verify your API keys and endpoints
4. Test with a simple message first

---

**Note**: This chatbot is designed for development and testing purposes. For production use, consider implementing additional security measures and proper API key management. 