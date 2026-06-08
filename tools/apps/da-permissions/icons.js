/* eslint-disable import/no-unresolved */
import { html } from 'da-lit';

const ICON_DIR = new URL('./img/', import.meta.url).href;

// eslint-disable-next-line import/prefer-default-export
export const icon = (name, w = 16, h = 16, vb = '0 0 20 20') => html`
  <svg width=${w} height=${h} viewBox="${vb}" style="--iconPrimary: currentColor" aria-hidden="true">
    <use href="${ICON_DIR}${name}.svg#${name}"/>
  </svg>`;
