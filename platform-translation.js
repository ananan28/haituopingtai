'use strict';
const { createHash } = require('node:crypto');
function requestId(scope,value) {
  const hex=createHash('sha256').update(JSON.stringify([scope,value.accountId,value.conversationId,value.messageId || '',value.metadata || '',value.question,value.language])).digest('hex').slice(0,32);
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
}
function createTranslator({getClient,access}) {
  return async value => {
    const identity=access.current(),revision=access.revision();
    if(!identity || identity.demo || identity.local || !access.can('translate') || identity.scope!==value.scope || !identity.accountIds.includes(value.accountId)) throw new Error('Platform identity required');
    const client=getClient();
    if(!client) throw new Error('Platform service not configured');
    const body={ requestId:requestId(identity.scope,value),accountId:value.accountId,conversationId:value.conversationId,
      messageId:value.messageId || '',metadata:value.metadata || '',question:value.question,language:value.language };
    const {data,error}=await client.functions.invoke('platform-translate',{body});
    if(revision!==access.revision() || access.current()?.scope!==identity.scope) throw new Error('Identity changed');
    if(error || !data?.ok || typeof data.text!=='string' || !data.text || typeof data.provider!=='string') throw new Error('Platform translation failed');
    return {text:data.text,provider:data.provider};
  };
}
module.exports={createTranslator,requestId};
