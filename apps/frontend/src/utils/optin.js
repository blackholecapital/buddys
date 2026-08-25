const form=document.getElementById("demoForm");
const consent=document.getElementById("smsConsent");
const button=document.getElementById("demoButton");
const note=document.getElementById("demoNote");

function getFieldValue(name){
 const field=form.elements[name];
 if(!field) return "";
 if(field instanceof RadioNodeList) return field.value||"";
 return String(field.value||"").trim();
}

button.disabled=false;
note.textContent="SMS notifications are optional. You may request a demonstration with or without text messages.";
note.classList.remove("active");

form.addEventListener("submit",async(e)=>{
 e.preventDefault();
 const payload={
  leadId:`XYZ-${Date.now()}`,
  owner:getFieldValue("owner"),
  name:getFieldValue("name"),
  company:getFieldValue("company"),
  email:getFieldValue("email"),
  phone:getFieldValue("phone"),
  interest:getFieldValue("interest"),
  notes:getFieldValue("notes"),
  consent: consent ? consent.checked : false,
  source:"Website Demo",
  timestamp:new Date().toISOString()
 };
 button.disabled=true;
 note.textContent="Submitting demo request...";
 try{
  const endpoint=form.dataset.endpoint;
  const response=await fetch(endpoint,{
   method:"POST",
   headers:{"Content-Type":"application/json"},
   body:JSON.stringify(payload)
  });
  if(!response.ok) throw new Error();
  const result=await response.json().catch(()=>({}));
  form.reset();
  button.disabled=false;
  note.textContent=`Demo submitted. Lead ID: ${result.leadId||payload.leadId}`;
 }catch(err){
  button.disabled=false;
  note.textContent="Submission failed. Please try again.";
 }
});
