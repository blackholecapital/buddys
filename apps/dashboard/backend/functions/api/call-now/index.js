const contacts = require("../../../layers/domain/contacts");
const activity = require("../../../layers/domain/activity");
const { conciergePost } = require("../../../../shared/services/concierge");

const { verify } = require("../../../../shared/services/video-session-auth");

module.exports = async function handler({ method, params, env }) {
  if (method !== "GET") return { ok:false, error:"GET only" };

  const contactId = String(params.id || "");
  const provided = String(params.sig || "");
  if (!contactId || !provided || !env.INTERNAL_CALL_SECRET) {
    return { ok:false, error:"Invalid call link" };
  }

  const contact = contacts.list().find((row) => row && row.id === contactId) || null;
  if (!await verify(env.INTERNAL_CALL_SECRET,provided,contact,"call") || contact.usedCallToken===provided) {
    return { ok:false, error:"Call link expired, invalid or already used" };
  }
  if (!contact.phone) return { ok:false, error:"No phone number is available for this request" };
  if (contact.optedOut) return { ok:false, error:"This contact has opted out" };

  activity.record({
    type:"call.requested",
    entityType:"contact",
    entityId:contact.id,
    message:`Buddy email call-now requested for ${contact.firstName || contact.phone}`,
    metadata:{ source:"buddy-email-call-link" },
  });

  contacts.update(contactId,{usedCallToken:provided});
  try {
    const result = await conciergePost(env, "/internal/calls", {
      contactId:contact.id,
      contact,
      trigger:{ type:"email-call-link", preferredContactMethod:"Email" },
    });
    if(result?.ok!==true)return {ok:false,error:result?.error||"Provider did not confirm the call"};
    return {
      ok:true,
      message:"Buddy is calling you now. You can close this page.",
      contactId:contact.id,
      call:result,
    };
  } catch (error) {
    return { ok:false, error:error.message || "Unable to start Buddy call" };
  }
};
