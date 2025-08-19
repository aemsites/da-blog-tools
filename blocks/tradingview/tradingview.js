import { readBlockConfig } from '../../scripts/aem.js';
import { createElement } from '../../scripts/utils.js';

export default function decorate(block) {
  const blockConfig = readBlockConfig(block);

  // Helper function to create placeholders needed for the widget script to decorate
  function createWidgetElements(script, config) {
    // CREATE WIDGET DOM : container
    const containerEl = createElement('div', { class: 'tradingview-widget-container' });

    // CREATE WIDGET DOM : placeholder
    const widgetEl = createElement('div', { class: 'tradingview-widget-container__widget' });

    // CREATE WIDGET DOM : copyright link
    const copyrightEl = createElement('div', { class: 'tradingview-widget-copyright' });
    copyrightEl.innerHTML = `
    <a href="https://www.tradingview.com/" rel="noopener nofollow" target="_blank">
      <span class="blue-text">Track all markets on TradingView</span>
    </a>
    `;

    // CREATE WIDGET DOM : the script tag
    const scriptPrefix = 'https://s3.tradingview.com/external-embedding/';
    const scriptEl = createElement('script', { type: 'text/javascript', src: `${scriptPrefix}${script}`, async: true });
    scriptEl.textContent = JSON.stringify(config);

    // CREATE WIDGET DOM : Append widget elements and add container to block
    containerEl.appendChild(widgetEl);
    containerEl.appendChild(copyrightEl);
    containerEl.appendChild(scriptEl);

    return containerEl;
  }

  function extractWidgetJsonConfig(blockEl) {
    const codeBlock = blockEl?.querySelector('pre > code');
    if (codeBlock) {
      try {
        return JSON.parse(codeBlock.textContent);
      } catch (err) {
        // Suppress the error
      }
    }
    return {};
  }

  // Create widget elements needed for its script to decorate
  const widgetEl = createWidgetElements(blockConfig.script, extractWidgetJsonConfig(block));
  block.textContent = '';

  // add event listener for intersection observer when block is in view port
  const options = {
    root: null,
    rootMargin: '20%',
    threshold: 1.0,
  };
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        block.replaceChildren(widgetEl);
        observer.unobserve(block);
      }
    });
  }, options);

  // observe the block
  observer.observe(block);

  // Apply the specified height
  block.style.height = blockConfig.height;
}
