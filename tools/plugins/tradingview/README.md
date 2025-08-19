# TradingView Widget Plugin for Document Authoring

> **Pattern Showcase**: Copy/Paste Third-Party Embeds While Maintaining Best Practices

This plugin demonstrates a powerful pattern for handling third-party embed codes in Document Authoring (DA) environments. It bridges the gap between author convenience and developer best practices by allowing authors to copy/paste embed codes while ensuring no custom HTML enters the document.

## Problem Statement

**The Challenge**: Authors want to embed third-party widgets (like TradingView) using familiar copy/paste workflows, but:
- Edge Delivery doesn't support custom HTML (anti-pattern)
- Third-party embed codes often have 100+ configuration options
- Authors shouldn't need to understand complex widget parameters
- Developers need to maintain security and code quality standards

**The Solution**: Create a DA plugin that accepts embed codes, parses them intelligently, and converts them to structured block content.

## How It Works

### Author Workflow
1. Visit [TradingView Widget Library](https://www.tradingview.com/widget/)
2. Configure your desired widget (charts, tickers, market data, etc.)
3. Copy the generated HTML embed code
4. Open this DA plugin from the sidekick
5. Paste the embed code into the textarea
6. Click "Insert TradingView Widget Block"
7. The plugin automatically creates a properly structured block in your document

### Developer Implementation
The plugin intelligently:
- **Parses** the HTML embed code using DOM parsing
- **Validates** the source URL (must be from `s3.tradingview.com`)
- **Extracts** the script filename and JSON configuration
- **Converts** to a structured table format DA understands
- **Generates** clean, secure block markup

## Technical Architecture

### DA Plugin

```
tools/plugins/tradingview/
├── tradingview.html     # User interface
├── tradingview.js       # Parsing and conversion logic  
├── tradingview.css      # Plugin styling
└── README.md           # Plugin documentation
```

### Block Implementation

```
blocks/tradingview/
├── tradingview.js       # Widget rendering logic
└── tradingview.css      # Widget styling
```
