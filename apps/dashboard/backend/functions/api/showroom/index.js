const catalog = require('../../../../../shared/buddy-catalog.cjs');
const { readDb } = require('../../../layers/core/db');
const activity = require('../../../layers/domain/activity');
const { verify } = require('../../../../shared/services/video-session-auth');
const { chatIdentity } = require('../../../../shared/services/customer-conversation');
const rateLimits = require('../../../layers/domain/rateLimits');

module.exports = async function handler({method,body={},params={},env}) {
  if (method === 'GET') {
    const category = catalog.categoryFor(params.category);
    return {ok:true,catalogVersion:catalog.VERSION,categories:catalog.categories,category,products:catalog.products(category)};
  }
  if (method !== 'POST') return {ok:false,error:'GET or POST only'};
  if (!['product.shown','product.opened'].includes(body.event)) return {ok:false,error:'Unsupported showroom event'};
  let identity=await chatIdentity(env,body);
  if (!identity) {
    const contact=readDb().contacts.find(c=>c.id===body.contactId);
    if (!await verify(env?.INTERNAL_CALL_SECRET,body.workflowToken,contact,'workflow',body.sessionId)) return {ok:false,error:'Invalid showroom session'};
    identity={contact,subject:contact,conversation:{id:body.sessionId}};
  }
  const category=identity.contact?.interest || body.category;
  const product=catalog.products(category).find(p=>p.id===body.productId);
  if (!product || body.catalogVersion!==catalog.VERSION) return {ok:false,error:'Product no longer matches the showroom'};
  const eventKey=`${identity.conversation.id}:${body.event}:${product.id}`;
  if ((readDb().activities||[]).some(a=>a.entityId===identity.subject.id && a.metadata?.eventKey===eventKey)) return {ok:true,duplicate:true};
  const guard=rateLimits.checkAndTrack('buddy-showroom-events');
  if(!guard.allowed)return {ok:false,error:'Showroom event limit reached'};
  activity.record({type:body.event,entityType:identity.contact?'contact':'conversation',entityId:identity.subject.id,
    message:`${product.name} ${body.event==='product.shown'?'shown':'opened'}`,
    metadata:{eventKey,productId:product.id,category:product.category,catalogVersion:catalog.VERSION,source:'customer-ui',sessionId:identity.conversation.id}});
  return {ok:true};
};
