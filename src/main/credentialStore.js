const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, safeStorage } = require('electron');
const { PLATFORMS } = require('./platforms');

const FILE_NAME = 'credentials.enc.json';

function getFilePath() {
  return path.join(app.getPath('userData'), FILE_NAME);
}

function readRaw() {
  const filePath = getFilePath();
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function writeRaw(data) {
  fs.writeFileSync(getFilePath(), JSON.stringify(data, null, 2), 'utf8');
}

function getPlatformConfig(platformId) {
  const platform = PLATFORMS.find((p) => p.id === platformId);
  if (!platform) throw new Error(`Nieznana platforma: ${platformId}`);
  return platform;
}

function encryptFields(fields, sensitiveFields) {
  const result = {};
  for (const [key, value] of Object.entries(fields || {})) {
    if (value === undefined || value === null || value === '') continue;
    if (sensitiveFields.includes(key)) {
      result[key] = { enc: true, value: safeStorage.encryptString(String(value)).toString('base64') };
    } else {
      result[key] = { enc: false, value: String(value) };
    }
  }
  return result;
}

function decryptFields(storedFields) {
  const result = {};
  for (const [key, entry] of Object.entries(storedFields || {})) {
    result[key] = entry.enc ? safeStorage.decryptString(Buffer.from(entry.value, 'base64')) : entry.value;
  }
  return result;
}

function listAccounts(platformId) {
  const store = readRaw();
  const accounts = store[platformId] || [];
  return accounts.map((account) => ({
    ...account,
    fields: decryptFields(account.fields),
  }));
}

function saveAccount(platformId, account) {
  const platform = getPlatformConfig(platformId);
  const store = readRaw();
  const accounts = store[platformId] || [];

  const accountId = account.accountId || crypto.randomUUID();
  const existingIndex = accounts.findIndex((a) => a.accountId === accountId);
  const fallbackIndex = !platform.multiAccount && accounts.length > 0 ? 0 : -1;
  const targetIndex = existingIndex >= 0 ? existingIndex : fallbackIndex;
  const existingEntry = targetIndex >= 0 ? accounts[targetIndex] : null;

  // Puste pole wrazliwe przy edycji (np. haslo zostawione puste) oznacza "zachowaj poprzednia wartosc".
  const newEncryptedFields = encryptFields(account.fields, platform.sensitiveFields || []);
  const mergedFields = { ...(existingEntry ? existingEntry.fields : {}), ...newEncryptedFields };

  const entry = {
    accountId: existingEntry ? existingEntry.accountId : accountId,
    label: account.label || '',
    city: account.city || '',
    company: account.company || '',
    periodMode: account.periodMode || platform.defaultPeriodMode || 'current_week',
    periodFrom: account.periodFrom || null,
    periodTo: account.periodTo || null,
    fields: mergedFields,
  };

  if (targetIndex >= 0) {
    accounts[targetIndex] = entry;
  } else {
    accounts.push(entry);
  }

  store[platformId] = accounts;
  writeRaw(store);
  return entry.accountId;
}

function deleteAccount(platformId, accountId) {
  const store = readRaw();
  const accounts = store[platformId] || [];
  store[platformId] = accounts.filter((a) => a.accountId !== accountId);
  writeRaw(store);
}

module.exports = {
  listAccounts,
  saveAccount,
  deleteAccount,
};
