(() => {
  'use strict';

  // Paths are fixed relative to src/index.html; no user input becomes a URL.
  // "verified" means source/bytes verified, not trademark permission or integration.
  // Two tiers: entries in `assets` are verified official/brand artwork; channels listed in
  // `pendingNotes` stay on the neutral placeholder until first-party artwork is confirmed.
  const assets = Object.freeze({
    'whatsapp-pure': '../assets/channel-icons/whatsapp-pure.svg',
    'telegram-k': '../assets/channel-icons/telegram-k.png',
    'telegram-a': '../assets/channel-icons/telegram-a.svg',
    signal: '../assets/channel-icons/signal.svg',
    line: '../assets/channel-icons/line.png',
    'line-works': '../assets/channel-icons/line-works.svg',
    twitter: '../assets/channel-icons/twitter.png',
    discord: '../assets/channel-icons/discord.png',
    'google-voice': '../assets/channel-icons/google-voice.svg',
    'google-voice-biz': '../assets/channel-icons/google-voice.svg',
    zalo: '../assets/channel-icons/zalo.svg',
    pingme: '../assets/channel-icons/pingme.png',
    livechat: '../assets/channel-icons/livechat.svg',
    salesmartly: '../assets/channel-icons/salesmartly.svg',
    meiqia: '../assets/channel-icons/meiqia.svg',
    getindex: '../assets/channel-icons/getindex.png',
    textfree: '../assets/channel-icons/textfree.png',
    textnow: '../assets/channel-icons/textnow.svg',
    zoom: '../assets/channel-icons/zoom.png',
    band: '../assets/channel-icons/band.png',
    facebook: '../assets/channel-icons/facebook.svg',
    messenger: '../assets/channel-icons/messenger.svg',
    instagram: '../assets/channel-icons/instagram.svg',
    threads: '../assets/channel-icons/threads.svg',
    tiktok: '../assets/channel-icons/tiktok.svg',
    teams: '../assets/channel-icons/teams.svg',
    'meta-business': '../assets/channel-icons/meta-business.svg',
    snapchat: '../assets/channel-icons/snapchat.svg',
    tigergpt: '../assets/channel-icons/tigergpt.png'
  });

  const aliases = Object.freeze({ whatsapp: 'whatsapp-pure', telegram: 'telegram-k' });

  // Provenance for the 2026-10-25 additions. "Official/brand resource" means the artwork is
  // publicly hosted by the brand or on Wikimedia Commons as its official logo; this establishes
  // provenance only, NOT trademark permission, endorsement, or commercial-use authorization.
  // Pre-existing assets keep their full provenance in assets/channel-icons/sources.json.
  const sources = Object.freeze({
    facebook: { source: 'Wikimedia Commons · File:2021 Facebook icon.svg', url: 'https://commons.wikimedia.org/wiki/File:2021_Facebook_icon.svg', obtained: '2026-10-25' },
    messenger: { source: 'Wikimedia Commons · File:Facebook Messenger logo 2020.svg', url: 'https://commons.wikimedia.org/wiki/File:Facebook_Messenger_logo_2020.svg', obtained: '2026-10-25' },
    instagram: { source: 'Wikimedia Commons · File:Instagram logo 2022.svg', url: 'https://commons.wikimedia.org/wiki/File:Instagram_logo_2022.svg', obtained: '2026-10-25' },
    threads: { source: 'Wikimedia Commons · File:Threads (app) logo.svg', url: 'https://commons.wikimedia.org/wiki/File:Threads_(app)_logo.svg', obtained: '2026-10-25' },
    tiktok: { source: 'Wikimedia Commons · File:Tiktok icon.svg', url: 'https://commons.wikimedia.org/wiki/File:Tiktok_icon.svg', obtained: '2026-10-25' },
    teams: { source: 'Wikimedia Commons · File:Microsoft Office Teams (2025–present).svg', url: 'https://commons.wikimedia.org/wiki/File:Microsoft_Office_Teams_(2025%E2%80%93present).svg', obtained: '2026-10-25' },
    'meta-business': { source: 'Wikimedia Commons · File:Meta Platforms Inc. logo.svg', url: 'https://commons.wikimedia.org/wiki/File:Meta_Platforms_Inc._logo.svg', obtained: '2026-10-25' },
    snapchat: { source: 'snap.com official brand assets (BLACK_SNAPCHAT_LOGO.svg)', url: 'https://www.snap.com/en-US/', obtained: '2026-10-25' },
    tigergpt: { source: 'tigergpt.com official site (logo_tigergpt.png)', url: 'https://www.tigergpt.com/', obtained: '2026-10-25' }
  });

  // Channels kept on the neutral placeholder: no verifiable first-party artwork was found.
  const pendingNotes = Object.freeze({
    'whatsapp-business': '无独立可核验的 WhatsApp Business 专用官方素材（区别于 WhatsApp，不冒用其图标）。',
    'line-biz': 'LINE Biz 独立字标无干净可核验的官方素材。',
    'textr-team': '官方域名状态不明（textr.net 已跳转 morphem.net，textr.com 为待售页），无法唯一确认官方素材。',
    xchat: '主体/含义不明确，无可核验的官方标识。',
    chats007: '007Chats 无公开可核验的官方素材。',
    zaobianhua: '灶边话 无公开可核验的官方素材。',
    cocezd: 'Cocezd 无公开可核验的官方素材。'
  });

  const owns = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const canonicalId = (channelId) => {
    if (typeof channelId !== 'string') return '';
    return owns(aliases, channelId) ? aliases[channelId] : channelId;
  };
  const escapes = Object.freeze({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' });
  const escapeText = (value) => value.replace(/[&<>"']/g, (character) => escapes[character]);
  const genericIcon = '<svg class="channel-generic-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#7c8491" stroke-width="1.6" aria-hidden="true" focusable="false"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>';

  function html(channelId, customAvatar = '') {
    const avatar = String(customAvatar ?? '');
    if (avatar) {
      return `<span class="channel-custom-avatar" aria-hidden="true">${escapeText(avatar)}</span>`;
    }

    const id = canonicalId(channelId);
    if (!owns(assets, id)) return genericIcon;

    const wordmark = ['line-works', 'meiqia', 'textnow', 'zoom', 'meta-business', 'snapchat', 'tigergpt'].includes(id);
    return `<img class="channel-official-icon${wordmark ? ' channel-wordmark-icon' : ''}" src="${assets[id]}" alt="" aria-hidden="true" width="28" height="28">`;
  }

  function status(channelId) {
    const id = canonicalId(channelId);
    if (id === 'custom') return 'custom';
    // Consumer Skype retired on 2025-05-05; it is not an active integration.
    if (id === 'skype') return 'retired';
    return owns(assets, id) ? 'verified' : 'pending';
  }

  window.HaituoChannelIcons = Object.freeze({ html, status, sources, pendingNotes });
})();
