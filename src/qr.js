import { buildConnectionShareUrl } from './share-link.js';
import qrcode from '../vendor/qrcode-generator/qrcode.js';

const QR_COPY_FEEDBACK_DELAY_MS = 1400;
const $ = (selector) => document.querySelector(selector);

const ui = {
  serverAddress: $('#server-address'),
  port: $('#port'),
  protocol: $('#protocol'),
  downsample: $('#downsample'),
  connectionQr: $('#connection-qr'),
  connectionQrCode: $('#connection-qr-code'),
  connectionQrLabel: $('#connection-qr-label')
};

let qrCopyFeedbackTimer;
let qrHovering = false;
let initialized = false;

function getConnectionSettings() {
  return {
    address: ui.serverAddress?.value ?? '',
    port: ui.port?.value ?? '',
    protocol: ui.protocol?.value ?? '',
    downsample: ui.downsample?.value ?? ''
  };
}

export function refreshConnectionQr() {
  if (!ui.connectionQr || !ui.connectionQrCode) return;

  const shareUrl = buildConnectionShareUrl(window.location.href, getConnectionSettings());
  ui.connectionQr.href = shareUrl;

  try {
    const qr = qrcode(0, 'M');
    qr.addData(shareUrl);
    qr.make();
    ui.connectionQrCode.innerHTML = qr.createSvgTag({
      cellSize: 4,
      margin: 8,
      scalable: true
    });
    ui.connectionQr.hidden = false;
  } catch {
    // QR sharing is optional; keep the viewer usable if generation fails.
    ui.connectionQr.hidden = true;
  }
}

function copyTextFallback(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-1000px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }

  textarea.remove();
  return copied;
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall back for browsers/contexts where Clipboard API permission fails.
    }
  }

  return copyTextFallback(text);
}

function updateQrLabel() {
  if (!ui.connectionQrLabel) return;
  ui.connectionQrLabel.textContent = qrCopyFeedbackTimer
    ? 'Link copied!'
    : qrHovering
      ? 'Copy link?'
      : 'Launch it';
}

function showQrCopyFeedback() {
  if (!ui.connectionQr) return;
  if (qrCopyFeedbackTimer) window.clearTimeout(qrCopyFeedbackTimer);

  ui.connectionQr.classList.remove('copy-confirmed');
  void ui.connectionQr.offsetWidth;
  ui.connectionQr.classList.add('copy-confirmed');

  qrCopyFeedbackTimer = window.setTimeout(() => {
    qrCopyFeedbackTimer = undefined;
    ui.connectionQr.classList.remove('copy-confirmed');
    updateQrLabel();
  }, QR_COPY_FEEDBACK_DELAY_MS);

  updateQrLabel();
}

async function handleConnectionQrClick(event) {
  event.preventDefault();
  if (ui.connectionQr && await copyTextToClipboard(ui.connectionQr.href)) {
    showQrCopyFeedback();
  }
}

function initializeConnectionQr() {
  if (initialized || !ui.connectionQr) return;
  initialized = true;

  ui.connectionQr.addEventListener('click', handleConnectionQrClick);
  ui.connectionQr.addEventListener('mouseenter', () => {
    qrHovering = true;
    updateQrLabel();
  });
  ui.connectionQr.addEventListener('mouseleave', () => {
    qrHovering = false;
    updateQrLabel();
  });

  refreshConnectionQr();
}

initializeConnectionQr();
