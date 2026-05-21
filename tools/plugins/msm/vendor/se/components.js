/* eslint-disable */
/*
 * Vendored snapshot of da-nx's nx2/public/se/components.js
 * (https://github.com/adobe/da-nx, ravuthu/se-select branch).
 *
 * Adapted for self-contained loading from this plugin:
 *  • loadStyle is inlined (upstream pulls it from ../../utils/utils.js, which
 *    we don't ship here).
 *  • The se-select checkmark <use> reference to an external SVG sprite is
 *    replaced with an inline <path>, so it works regardless of origin.
 *
 * Everything else (component logic, classes, exported tag names) mirrors
 * upstream so the public API stays identical to what OOTB MSM Prepare uses.
 *
 * To refresh: re-copy from da-nx and re-apply the two patches noted above.
 */

import { LitElement, html, nothing, spread } from 'https://da.live/deps/lit/dist/index.js';

const loadStyle = async (url) => {
  const cssUrl = url.replace(/\.js(\?.*)?$/, '.css');
  const resp = await fetch(cssUrl);
  const text = await resp.text();
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(text);
  return sheet;
};

const style = await loadStyle(import.meta.url);

class SlInput extends LitElement {
  static formAssociated = true;

  static properties = {
    value: { type: String },
    class: { type: String },
    label: { type: String },
    error: { type: String },
    name: { type: String },
  };

  constructor() {
    super();
    this._internals = this.attachInternals();
  }

  async connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [style];
    this._internals.setFormValue(this.value);
  }

  focus() {
    this.shadowRoot.querySelector('input').focus();
  }

  handleEvent(event) {
    this.value = event.target.value;
    this._internals.setFormValue(this.value);
    const wcEvent = new event.constructor(event.type, event);
    this.dispatchEvent(wcEvent);
  }

  handleKeyDown(event) {
    if (event.key !== 'Enter') return;
    if (!this.form) return;

    const submitEvent = new SubmitEvent('submit', { bubbles: true, cancelable: true });
    this.form.dispatchEvent(submitEvent);

    if (submitEvent.defaultPrevented) return;
    this.form.submit();
  }

  get _attrs() {
    return this.getAttributeNames().reduce((acc, name) => {
      if ((name === 'class' || name === 'label' || name === 'value' || name === 'error')) return acc;
      acc[name] = this.getAttribute(name);
      return acc;
    }, {});
  }

  get form() { return this._internals.form; }

  render() {
    return html`
      <div class="sl-inputfield">
        ${this.label ? html`<label for="${this.name}">${this.label}</label>` : nothing}
        <input
          .value="${this.value || ''}"
          @input=${this.handleEvent}
          @change=${this.handleEvent}
          @keydown=${this.handleKeyDown}
          class="${this.class} ${this.error ? 'has-error' : ''}"
          ${spread(this._attrs)} />
        ${this.error ? html`<p class="sl-inputfield-error">${this.error}</p>` : nothing}
      </div>
    `;
  }
}

class SlTextarea extends LitElement {
  static formAssociated = true;

  static properties = {
    value: { type: String },
    class: { type: String },
    label: { type: String },
    error: { type: String },
    name: { type: String },
  };

  constructor() {
    super();
    this._internals = this.attachInternals();
  }

  async connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [style];
    this._internals.setFormValue(this.value);
  }

  handleEvent(event) {
    this.value = event.target.value;
    this._internals.setFormValue(this.value);
    const wcEvent = new event.constructor(event.type, event);
    this.dispatchEvent(wcEvent);
  }

  get form() { return this._internals.form; }

  get _attrs() {
    return this.getAttributeNames().reduce((acc, name) => {
      if ((name === 'class' || name === 'label' || name === 'value' || name === 'error')) return acc;
      acc[name] = this.getAttribute(name);
      return acc;
    }, {});
  }

  render() {
    return html`
      <div class="sl-inputfield sl-inputarea">
        ${this.label ? html`<label for="${this.name}">${this.label}</label>` : nothing}
        <textarea
          .value="${this.value || ''}"
          @input=${this.handleEvent}
          @change=${this.handleEvent}
          class="${this.class} ${this.error ? 'has-error' : ''} ${this.label ? 'has-label' : ''}"
          ${spread(this._attrs)}></textarea>
        ${this.error ? html`<p class="sl-inputfield-error">${this.error}</p>` : nothing}
      </div>
    `;
  }
}

class SlCheckbox extends LitElement {
  static formAssociated = true;

  static properties = {
    name: { type: String },
    checked: { type: Boolean },
    error: { type: String },
  };

  constructor() {
    super();
    this._internals = this.attachInternals();
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [style];
    this._updateFormValue();
  }

  get type() {
    return 'checkbox';
  }

  get value() {
    return this.checked ? 'true' : '';
  }

  _updateFormValue() {
    if (this.checked) {
      this._internals.setFormValue('true');
    } else {
      this._internals.setFormValue('');
    }
  }

  handleChange(event) {
    this.checked = event.target.checked;
    this._updateFormValue();
    const wcEvent = new event.constructor(event.type, { bubbles: true, composed: true });
    this.dispatchEvent(wcEvent);
  }

  render() {
    return html`
      <div class="sl-checkbox">
        <input
          type="checkbox"
          id="${this.name}"
          name="${this.name}"
          ?checked=${this.checked}
          class="${this.error ? 'has-error' : ''}"
          @change=${this.handleChange}
        />
        <label for="${this.name}"><slot></slot></label>
        ${this.error ? html`<p class="sl-inputfield-error">${this.error}</p>` : nothing}
      </div>
    `;
  }
}

class SlSelect extends LitElement {
  static formAssociated = true;

  static readOption(opt) {
    return {
      value: opt.value,
      label: opt.textContent.trim(),
      disabled: opt.hasAttribute('disabled'),
    };
  }

  static properties = {
    name: { type: String },
    label: { type: String },
    value: { type: String },
    disabled: { type: Boolean },
    placeholder: { type: String },
    error: { type: String },
    _open: { state: true },
    _activeIndex: { state: true },
    _groups: { state: true },
  };

  constructor() {
    super();
    this._open = false;
    this._activeIndex = -1;
  }

  _restoreFocusOnClose = false;

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [style];
    this._internals = this.attachInternals();
    this._internals.setFormValue(this.value);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._removeOutsideListeners();
  }

  update(props) {
    if (props.has('value')) this._internals.setFormValue(this.value);
    if (props.has('_open')) {
      if (this._open) this._addOutsideListeners();
      else this._removeOutsideListeners();
    }
    super.update(props);
  }

  updated(props) {
    if (props.has('_open')) {
      if (this._open) {
        this.shadowRoot.querySelector('.sl-select-menu')?.focus();
        this._scrollActiveIntoView();
      } else if (this._restoreFocusOnClose) {
        this._restoreFocusOnClose = false;
        this.shadowRoot.querySelector('.sl-select-trigger')?.focus();
      }
    }
    if (props.has('_activeIndex') && this._open) this._scrollActiveIntoView();
  }

  _scrollActiveIntoView() {
    const items = this.shadowRoot.querySelectorAll('.sl-select-item');
    items[this._activeIndex]?.scrollIntoView({ block: 'nearest' });
  }

  handleSlotchange(e) {
    this._buildGroups(e.target.assignedNodes({ flatten: true }));
  }

  _buildGroups(nodes) {
    const groups = nodes.reduce((acc, node) => {
      if (node.nodeName === 'OPTGROUP') {
        const group = {
          heading: node.label || '',
          items: [...node.querySelectorAll('option')].map(SlSelect.readOption),
        };
        return [...acc, group];
      }
      if (node.nodeName === 'OPTION') {
        const last = acc[acc.length - 1];
        const updated = { ...last, items: [...last.items, SlSelect.readOption(node)] };
        return [...acc.slice(0, -1), updated];
      }
      return acc;
    }, [{ heading: null, items: [] }]);

    this._groups = groups.filter((g) => g.items.length > 0);

    if (!this.value) {
      const first = this._flatOptions().find((o) => !o.disabled);
      if (first) {
        this.value = first.value;
        this._internals.setFormValue(this.value);
      }
    }
  }

  _flatOptions() {
    return this._groups?.flatMap((g) => g.items) ?? [];
  }

  _selectedLabel() {
    const match = this._flatOptions().find((o) => o.value === this.value);
    return match?.label ?? this.placeholder ?? '';
  }

  _toggle() {
    if (this.disabled) return;
    this._open = !this._open;
    if (this._open) this._activeIndex = -1;
  }

  _close({ returnFocus = false } = {}) {
    if (returnFocus) this._restoreFocusOnClose = true;
    this._open = false;
  }

  _addOutsideListeners() {
    document.addEventListener('pointerdown', this._onDocPointerDown, true);
  }

  _removeOutsideListeners() {
    document.removeEventListener('pointerdown', this._onDocPointerDown, true);
  }

  _onDocPointerDown = (e) => {
    if (!e.composedPath().includes(this)) this._close();
  };

  _selectValue(value) {
    if (this.value !== value) {
      this.value = value;
      this._internals.setFormValue(value);
      this.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    }
    this._close({ returnFocus: true });
  }

  _onTriggerKeydown(e) {
    if (this.disabled) return;
    if (this._open) {
      if (e.key === 'Escape') {
        e.preventDefault();
        this._close({ returnFocus: true });
      }
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault();
      this._toggle();
    }
  }

  _onMenuKeydown(e) {
    const flat = this._flatOptions();
    const moveTo = (start, dir) => {
      let i = start;
      for (let n = 0; n < flat.length; n += 1) {
        i = (i + dir + flat.length) % flat.length;
        if (!flat[i].disabled) return i;
      }
      return start;
    };
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this._activeIndex = moveTo(this._activeIndex, 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this._activeIndex = moveTo(this._activeIndex, -1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      this._activeIndex = moveTo(-1, 1);
    } else if (e.key === 'End') {
      e.preventDefault();
      this._activeIndex = moveTo(0, -1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const opt = flat[this._activeIndex];
      if (opt && !opt.disabled) this._selectValue(opt.value);
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      this._close({ returnFocus: true });
    }
  }

  render() {
    const selectedLabel = this._selectedLabel();
    let runningIndex = -1;
    return html`
      <slot @slotchange=${this.handleSlotchange} hidden></slot>
      <div class="sl-inputfield">
        ${this.label ? html`<label for="${this.name}">${this.label}</label>` : nothing}
        <div class="sl-select ${this._open ? 'open' : ''} ${this.error ? 'has-error' : ''}">
          <button
            type="button"
            class="sl-select-trigger"
            aria-haspopup="listbox"
            aria-expanded=${this._open}
            ?disabled=${this.disabled}
            @click=${this._toggle}
            @keydown=${this._onTriggerKeydown}>
            <span class="sl-select-label ${this.value ? '' : 'is-placeholder'}">${selectedLabel}</span>
          </button>
          ${this._open ? html`
            <ul class="sl-select-menu" role="listbox" aria-label=${this.label || ''}
              tabindex="-1" @keydown=${this._onMenuKeydown}>
              ${this._groups?.map((group) => html`
                ${group.heading ? html`
                  <li class="sl-select-group" role="presentation">${group.heading}</li>
                ` : nothing}
                ${group.items.map((opt) => {
    runningIndex += 1;
    const idx = runningIndex;
    const isActive = idx === this._activeIndex;
    const isSelected = opt.value === this.value;
    return html`
                    <li class="sl-select-item ${isSelected ? 'selected' : ''} ${isActive ? 'active' : ''} ${opt.disabled ? 'disabled' : ''}"
                      role="option"
                      aria-selected=${isSelected}
                      aria-disabled=${opt.disabled}
                      @mouseenter=${() => { this._activeIndex = idx; }}
                      @click=${() => !opt.disabled && this._selectValue(opt.value)}>
                      <svg class="sl-select-check" viewBox="0 0 20 20">
                        <path fill="currentColor" d="M7.86426,15.73438c-.22266,0-.43359-.09863-.57617-.26953l-3.74707-4.49805c-.26562-.31836-.22168-.79199.0957-1.05664.31738-.26562.79004-.22363,1.05664.0957l3.15332,3.78613,7.43945-9.46875c.25586-.32617.72852-.38184,1.05273-.12695.32617.25586.38281.72754.12695,1.05273l-8.01172,10.19824c-.13965.17871-.35254.28418-.5791.28711h-.01074Z"/>
                      </svg>
                      <span>${opt.label}</span>
                    </li>`;
  })}
              `)}
            </ul>
          ` : nothing}
        </div>
        ${this.error ? html`<p class="sl-inputfield-error">${this.error}</p>` : nothing}
      </div>
    `;
  }
}

class SlButton extends LitElement {
  static formAssociated = true;

  static properties = {
    class: { type: String },
    disabled: { type: Boolean },
    type: { type: String },
  };

  constructor() {
    super();
    this._internals = this.attachInternals();
    this.type = 'button';
  }

  async connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [style];
  }

  get _attrs() {
    return this.getAttributeNames().reduce((acc, name) => {
      if ((name === 'class' || name === 'label' || name === 'disabled' || name === 'type')) return acc;
      acc[name] = this.getAttribute(name);
      return acc;
    }, {});
  }

  handleClick() {
    if (this.disabled) return;
    const { form } = this._internals;
    if (!form) return;
    if (this.type === 'submit') form.requestSubmit();
    else if (this.type === 'reset') form.reset();
  }

  render() {
    return html`
      <span class="sl-button" part="wrap">
        <button
          part="base"
          type="button"
          class="${this.class}"
          ?disabled=${this.disabled}
          @click=${this.handleClick}
          ${spread(this._attrs)}>
          <slot></slot>
        </button>
      </span>`;
  }
}

class SlDialog extends LitElement {
  static properties = {
    open: { type: Boolean },
    modal: { type: Boolean },
    overflow: { type: String },
    _showLazyModal: { state: true },
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [style];
  }

  updated() {
    if (this._showLazyModal && this._dialog) {
      this._showLazyModal = undefined;
      this.showModal();
    }
  }

  showModal() {
    if (!this._dialog) {
      this._showLazyModal = true;
      return;
    }
    this._dialog.showModal();
  }

  show() {
    this._dialog.show();
  }

  close() {
    this._dialog.close();
  }

  onClose(e) {
    this.dispatchEvent(new Event('close', e));
  }

  get _dialog() {
    return this.shadowRoot.querySelector('dialog');
  }

  render() {
    return html`
      <dialog class="sl-dialog ${this.overflow ? `overflow-${this.overflow}` : ''}" @close=${this.onClose}>
        <slot></slot>
      </dialog>`;
  }
}

if (!customElements.get('se-input')) customElements.define('se-input', SlInput);
if (!customElements.get('se-textarea')) customElements.define('se-textarea', SlTextarea);
if (!customElements.get('se-checkbox')) customElements.define('se-checkbox', SlCheckbox);
if (!customElements.get('se-select')) customElements.define('se-select', SlSelect);
if (!customElements.get('se-button')) customElements.define('se-button', SlButton);
if (!customElements.get('se-dialog')) customElements.define('se-dialog', SlDialog);
