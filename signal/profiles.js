'use strict';
/**
 * signal/profiles.js — Signal 多账号 per-profile 隔离注册表（P4 基础）。
 *
 * 每个 Signal 账号 = 一个 profile = 一个独立 userData 目录 = 一个独立 SQL worker
 * 池/DB（sqlcipher）。渲染器进程按 event.sender 路由到对应 profile 的 SQL 客户端。
 *
 * 本模块无 electron 依赖，纯函数 + 内存映射，便于单测。
 */
const path = require('node:path');

// accountId -> profile 名（bundle 用 /^signal-[\w-]+/ 识别；signal-main 为主账号）。
function profileForAccount(accountId) {
  const safe = String(accountId).replace(/[^a-zA-Z0-9_-]/g, '-');
  return 'signal-' + safe;
}

// profile -> userData 目录。沿用旧海拓约定 %APPDATA%/Haituo/SignalProfiles/<profile>，
// 使 SQL worker 的 configDir/sql/db.sqlite 与旧实现一致。
function userDataForProfile(profile, appData) {
  return path.join(appData, 'Haituo', 'SignalProfiles', String(profile));
}

// webContents.id -> profile：SQL 客户端按 event.sender 路由。
const webContentsProfiles = new Map();

function bindWebContents(webContents, profile) {
  if (webContents && !webContents.isDestroyed()) webContentsProfiles.set(webContents.id, profile);
}

function unbindWebContents(webContents) {
  if (webContents) webContentsProfiles.delete(webContents.id);
}

function profileForWebContents(webContents) {
  if (!webContents) return null;
  return webContentsProfiles.get(webContents.id) || null;
}

module.exports = {
  profileForAccount,
  userDataForProfile,
  bindWebContents,
  unbindWebContents,
  profileForWebContents
};
