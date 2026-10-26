'use strict';
// Commercial translation must be supplied by the platform service, never by
// inherited per-client provider keys or the former free-translation defaults.
module.exports = Object.freeze({
  provider: 'platform', inputTranslationProvider: 'platform', chatTranslationProvider: 'platform', voiceTranscriptionProvider: 'platform',
  autoTranslateIncoming: false, blockChineseOutgoing: false, hideTranslationBox: true,
  backTranslationEnabled: false, groupBackTranslationEnabled: false,
  apiKey: '', groqApiKey: '', deepLApiKey: '', kepplApiKey: '', compatibleEndpoint: '',
  translationPools: null, screenshotApiPool: []
});
