/**
 * Humanize Text — Shared Library
 *
 * Strip common AI writing patterns to make text sound human.
 * Runs as a final pass on all draft output.
 *
 * Extracted from server/routes/reactive.js for reuse in copilot, chat, etc.
 */

function humanizeText(text) {
  if (!text) return text;

  let result = text;

  // ── STEP 1: Full-sentence filler removal ──
  // These add nothing. A real American support rep would never type these.

  const removePatterns = [
    // Scripted empathy — real people don't announce they understand
    /I want to assure you that\s*/gi,
    /I want to assure you\s*/gi,
    /I understand your frustration\.?\s*/gi,
    /I understand your concern\.?\s*/gi,
    /I understand how frustrating this (?:can be|is|must be)\.?\s*/gi,
    /I understand how (?:difficult|challenging|inconvenient) this (?:can be|is|must be)\.?\s*/gi,
    /I completely understand\.?\s*/gi,
    /I totally understand\.?\s*/gi,
    /I can only imagine how (?:frustrating|difficult|inconvenient) this (?:is|must be|has been)\.?\s*/gi,
    /I know this (?:isn't|is not) (?:ideal|what you (?:wanted|expected))\.?\s*/gi,
    // "Don't hesitate" — nobody talks like this
    /Please don't hesitate to reach out\.?\s*/gi,
    /Please don't hesitate to contact us\.?\s*/gi,
    /Please do not hesitate to\s*/gi,
    /Please don't hesitate to\s*/gi,
    /don't hesitate to reach out\.?\s*/gi,
    /do not hesitate to\s*/gi,
    /don't hesitate to\s*/gi,
    /feel free to reach out\.?\s*/gi,
    /feel free to contact us\.?\s*/gi,
    /feel free to reach back out\.?\s*/gi,
    // Robotic enthusiasm
    /Rest assured,?\s*/gi,
    /Certainly!\s*/gi,
    /Absolutely!\s*/gi,
    /Of course!\s*/gi,
    /Great question!\s*/gi,
    /That's a great question\.?\s*/gi,
    // "Happy to help" — the #1 AI tell
    /I'd be happy to help you with that\.?\s*/gi,
    /I'd be happy to help\.?\s*/gi,
    /I'd be happy to assist you with\s*/gi,
    /I'd be happy to assist you\.?\s*/gi,
    /I'm happy to help\.?\s*/gi,
    /I'm happy to assist\.?\s*/gi,
    /I'm here to help\.?\s*/gi,
    /I'd love to help(?:\syou)? with (?:that|this)\.?\s*/gi,
    /Let me help you with that\.?\s*/gi,
    // Empty closers — filler at the end
    /I hope this helps\.?\s*/gi,
    /I hope that helps\.?\s*/gi,
    /I hope this resolves your (?:issue|concern|problem)\.?\s*/gi,
    /I hope this information (?:is helpful|helps)\.?\s*/gi,
    /Hope that helps\.?\s*/gi,
    /Hope this helps\.?\s*/gi,
    /I trust this (?:helps|answers your question|resolves your concern)\.?\s*/gi,
    /Please let me know if (?:there is|there's) anything else I can (?:help|assist) (?:you )?with\.?\s*/gi,
    /Is there anything else I can (?:help|assist) you with\.?\s*/gi,
    // Corporate filler
    /Thank you for your patience and understanding\.?\s*/gi,
    /Thank you for your understanding\.?\s*/gi,
    /Thank you for bringing this to our attention\.?\s*/gi,
    /Thank you for contacting us\.?\s*/gi,
    /Thank you for reaching out to us\.?\s*/gi,
    /Thanks for your patience and understanding\.?\s*/gi,
    /I appreciate your patience\.?\s*/gi,
    /I appreciate you reaching out\.?\s*/gi,
    /We appreciate your patience\.?\s*/gi,
    /We appreciate you reaching out\.?\s*/gi,
    /We value you as a customer\.?\s*/gi,
    /We value your (?:business|loyalty)\.?\s*/gi,
    /Your satisfaction is (?:our|my) (?:top |number one )?priority\.?\s*/gi,
    /Your (?:feedback|input) is (?:important|valuable) to us\.?\s*/gi,
    /We take (?:this|your concern|your feedback) (?:very )?seriously\.?\s*/gi,
    // Wordy padding — just say the thing
    /Please be advised that\s*/gi,
    /I wanted to let you know that\s*/gi,
    /I just wanted to (?:let you know|reach out|follow up|check in) (?:and |that )?\s*/gi,
    /I'm writing to inform you that\s*/gi,
    /I'm writing to let you know that\s*/gi,
    /As per our (?:conversation|discussion|records),?\s*/gi,
    /As mentioned (?:earlier|previously|above),?\s*/gi,
    /I would like to inform you that\s*/gi,
    /I wanted to take a moment to\s*/gi,
  ];
  for (const pattern of removePatterns) {
    result = result.replace(pattern, '');
  }

  // ── STEP 2: Corporate tone → casual American ──

  result = result.replace(/We(?:'re| are) reaching out to let you know that\s*/gi, '');
  result = result.replace(/We(?:'re| are) reaching out to inform you that\s*/gi, '');
  result = result.replace(/We(?:'re| are) reaching out because\s*/gi, '');
  result = result.replace(/We(?:'re| are) writing to let you know that\s*/gi, '');
  result = result.replace(/We(?:'re| are) writing to inform you that\s*/gi, '');
  result = result.replace(/We(?:'re| are) contacting you to\s*/gi, 'We wanted to ');
  result = result.replace(/We(?:'re| are) reaching out to\s*/gi, 'We wanted to ');
  result = result.replace(/We wanted to reach out and\s*/gi, 'We wanted to ');
  result = result.replace(/This (?:email|message) is to (?:inform|notify|let) you (?:that|of)\s*/gi, '');
  result = result.replace(/This is to (?:inform|notify) you that\s*/gi, '');
  result = result.replace(/The purpose of this (?:email|message) is to\s*/gi, '');

  result = result.replace(/We(?:'d| would) like to request\s*/gi, 'Can we set up ');
  result = result.replace(/We(?:'d| would) like to ask (?:you |that you )?\s*/gi, 'Could you ');
  result = result.replace(/We(?:'d| would) like to inform you that\s*/gi, '');
  result = result.replace(/We(?:'d| would) like to let you know that\s*/gi, '');
  result = result.replace(/We(?:'d| would) like to\s*/gi, "We'd like to ");
  result = result.replace(/We understand (?:that )?this (?:may be|is|can be) (?:an )?(?:inconvenient|inconvenience|frustrating|disruptive)/gi, 'We know this is a hassle');
  result = result.replace(/We understand (?:that )?this (?:may|might) (?:cause|be causing) (?:some )?(?:inconvenience|trouble|disruption)/gi, 'We know this is annoying');
  result = result.replace(/We understand (?:that )?this (?:is|may be) not ideal/gi, "We know this isn't ideal");
  result = result.replace(/This step is purely to\s*/gi, "This is just to ");
  result = result.replace(/This (?:process|step|measure) is (?:designed |intended |meant )?to (?:help )?\s*/gi, 'This helps ');
  result = result.replace(/Your cooperation (?:will |would )?(?:help|assist|enable) us (?:to )?\s*/gi, "This'll help us ");
  result = result.replace(/Your cooperation is (?:greatly )?appreciated\.?\s*/gi, '');
  result = result.replace(/Your (?:prompt )?(?:cooperation|response|attention) (?:is|would be) (?:greatly |much )?appreciated\.?\s*/gi, '');
  result = result.replace(/We (?:would )?(?:greatly |really )?appreciate your (?:prompt )?(?:cooperation|response|attention)\.?\s*/gi, '');

  result = result.replace(/To protect your account and (?:to )?(?:make sure|ensure)\s*/gi, 'To keep your account safe and make sure ');
  result = result.replace(/To (?:make sure|ensure) (?:the )?(?:security|safety|protection) of your (?:account|information|data)/gi, 'To keep your account safe');
  result = result.replace(/This helps us (?:to )?confirm (?:that )?there(?:'s| is) no risk of\s*/gi, "This way we can rule out ");
  result = result.replace(/(?:this|which) helps us (?:to )?confirm (?:that )?(?:there(?:'s| is) no|there are no)\s*/gi, 'so we can rule out any ');
  result = result.replace(/no risk of unauthorized or fraudulent activity/gi, 'unauthorized activity');
  result = result.replace(/unauthorized or fraudulent activity/gi, 'unauthorized activity');
  result = result.replace(/your account and personal information remain safe/gi, 'your account stays safe');

  result = result.replace(/at a time that works (?:best )?for you/gi, 'whenever works for you');
  result = result.replace(/at a time (?:that is |that's )?convenient for you/gi, 'whenever works for you');
  result = result.replace(/at your convenience/gi, 'whenever works for you');

  result = result.replace(/\bdue to some\b/gi, 'because of some');
  result = result.replace(/\bdue to\b/gi, 'because of');

  result = result.replace(/related to recent/gi, 'with recent');

  result = result.replace(/verify a few details/gi, 'confirm a couple things');
  result = result.replace(/verify (?:a few|some) (?:details|things|items)/gi, 'confirm a couple things');

  result = result.replace(/get your account back on track/gi, 'get you back up and running');
  result = result.replace(/get (?:this|things) back on track/gi, 'get this sorted');

  result = result.replace(/as quickly as possible/gi, 'as fast as we can');
  result = result.replace(/as soon as possible/gi, 'ASAP');

  result = result.replace(/please reply to this email with\s*/gi, 'Just reply with ');
  result = result.replace(/please respond to this email with\s*/gi, 'Just reply with ');
  result = result.replace(/please reply (?:to this email|back) (?:and |to )?let us know\s*/gi, 'Just let us know ');

  result = result.replace(/Thank you for your understanding and support\.?\s*/gi, '');
  result = result.replace(/Thank you for your support and understanding\.?\s*/gi, '');
  result = result.replace(/Thank you for your (?:continued )?support\.?\s*/gi, '');
  result = result.replace(/Thank you for your cooperation\.?\s*/gi, '');
  result = result.replace(/Thanks for your cooperation\.?\s*/gi, '');
  result = result.replace(/\band support\.?\s*$/gim, '');

  // ── STEP 3: Phrase swaps → how Americans actually talk ──

  result = result.replace(/I sincerely apologize/gi, "I'm really sorry");
  result = result.replace(/I deeply apologize/gi, "I'm really sorry");
  result = result.replace(/I apologize for the inconvenience/gi, "sorry about that");
  result = result.replace(/I apologize for any inconvenience/gi, "sorry about that");
  result = result.replace(/I apologize for any (?:issues|trouble|difficulties|problems)/gi, "sorry about that");
  result = result.replace(/We apologize for the inconvenience/gi, "sorry about that");
  result = result.replace(/We sincerely apologize/gi, "we're really sorry");
  result = result.replace(/I apologize/gi, "sorry");
  result = result.replace(/my apologies/gi, "sorry");
  result = result.replace(/our apologies/gi, "sorry");
  result = result.replace(/we apologize/gi, "we're sorry");

  result = result.replace(/Furthermore,?\s*/gi, 'Also, ');
  result = result.replace(/Additionally,?\s*/gi, 'Also, ');
  result = result.replace(/Moreover,?\s*/gi, 'Also, ');
  result = result.replace(/However,?\s*/gi, 'That said, ');
  result = result.replace(/Nevertheless,?\s*/gi, 'That said, ');
  result = result.replace(/Nonetheless,?\s*/gi, 'That said, ');
  result = result.replace(/Consequently,?\s*/gi, 'So ');
  result = result.replace(/Therefore,?\s*/gi, 'So ');
  result = result.replace(/Thus,?\s*/gi, 'So ');
  result = result.replace(/Hence,?\s*/gi, 'So ');
  result = result.replace(/Henceforth,?\s*/gi, 'From now on, ');

  result = result.replace(/I have gone ahead and\s*/gi, "I ");
  result = result.replace(/I've gone ahead and\s*/gi, "I've ");
  result = result.replace(/I went ahead and\s*/gi, "I ");
  result = result.replace(/I have (?:taken the liberty|gone ahead) (?:of|to)\s*/gi, "I ");
  result = result.replace(/At this time,?\s*/gi, 'Right now, ');
  result = result.replace(/At this point in time,?\s*/gi, 'Right now, ');
  result = result.replace(/At this juncture,?\s*/gi, 'Right now, ');
  result = result.replace(/I'd be happy to assist you with\s*/gi, 'I can help with ');
  result = result.replace(/I'd be happy to help you with\s*/gi, 'I can help with ');
  result = result.replace(/I'd be happy to\s*/gi, 'I can ');
  result = result.replace(/I'd be glad to\s*/gi, 'I can ');
  result = result.replace(/I would be happy to\s*/gi, 'I can ');
  result = result.replace(/I would like to\s*/gi, "I'd like to ");
  result = result.replace(/I can confirm that\s*/gi, '');
  result = result.replace(/I can assure you that\s*/gi, '');
  result = result.replace(/Please note that\s*/gi, 'Heads up, ');
  result = result.replace(/Please be aware that\s*/gi, 'Heads up, ');
  result = result.replace(/It is worth noting that\s*/gi, '');
  result = result.replace(/It should be noted that\s*/gi, '');
  result = result.replace(/It is important to note that\s*/gi, '');
  result = result.replace(/Kindly\s*/gi, 'Please ');
  result = result.replace(/(?:^|\.\s+)Apologies(?:,|\s)/gim, '. Sorry, ');
  result = result.replace(/upon (?:further )?(?:review|investigation|checking)/gi, 'after looking into this');
  result = result.replace(/after (?:further )?(?:review|investigation)/gi, 'after looking into this');
  result = result.replace(/(?:I have |I've )?(?:looked into|investigated|reviewed) (?:this |your )?(?:matter|issue|case|concern|situation)/gi, "I looked into this");
  result = result.replace(/It appears that\s*/gi, 'Looks like ');
  result = result.replace(/It seems that\s*/gi, 'Looks like ');
  result = result.replace(/It would appear that\s*/gi, 'Looks like ');
  result = result.replace(/I (?:would like to |want to )?bring to your attention that\s*/gi, '');
  result = result.replace(/we are (?:currently )?(?:in the process of|working on)\s*/gi, "we're working on ");
  result = result.replace(/we are pleased to inform you that\s*/gi, '');
  result = result.replace(/I am pleased to inform you that\s*/gi, '');
  result = result.replace(/you will be (?:glad|happy|pleased) to (?:know|hear) that\s*/gi, '');
  result = result.replace(/I'm pleased to let you know that\s*/gi, '');

  // ── STEP 4: Vocabulary — plain American English ──

  result = result.replace(/\butilize\b/gi, 'use');
  result = result.replace(/\butilizing\b/gi, 'using');
  result = result.replace(/\butilization\b/gi, 'use');
  result = result.replace(/\bfacilitate\b/gi, 'help with');
  result = result.replace(/\bfacilitating\b/gi, 'helping with');
  result = result.replace(/\bendeavor\b/gi, 'try');
  result = result.replace(/\bcommence\b/gi, 'start');
  result = result.replace(/\bcommencing\b/gi, 'starting');
  result = result.replace(/\bterminate\b/gi, 'end');
  result = result.replace(/\bterminated\b/gi, 'ended');
  result = result.replace(/\bpurchased\b/gi, 'bought');
  result = result.replace(/\bassistance\b/gi, 'help');
  result = result.replace(/\binquiry\b/gi, 'question');
  result = result.replace(/\binquiries\b/gi, 'questions');
  result = result.replace(/\brectify\b/gi, 'fix');
  result = result.replace(/\bresolve this matter\b/gi, 'get this sorted out');
  result = result.replace(/\bresolve this issue\b/gi, 'get this fixed');
  result = result.replace(/\bresolve (?:your |the )?(?:concern|problem)\b/gi, 'fix this');
  result = result.replace(/\bresolve this\b/gi, 'fix this');
  result = result.replace(/\bremedy\b/gi, 'fix');
  result = result.replace(/\bsubsequently\b/gi, 'after that');
  result = result.replace(/\bprior to\b/gi, 'before');
  result = result.replace(/\bensure\b/gi, 'make sure');
  result = result.replace(/\bensuring\b/gi, 'making sure');
  result = result.replace(/\binconvenience(?:d)?\b/gi, 'hassle');
  result = result.replace(/\binconvenient\b/gi, 'annoying');
  result = result.replace(/\bexperience(?:d)? (?:an |any )?(?:issue|difficulty|problem)/gi, 'had a problem');
  result = result.replace(/\bregarding\b\s*/gi, 'about ');
  result = result.replace(/\bin regards to\b\s*/gi, 'about ');
  result = result.replace(/\bwith regards to\b\s*/gi, 'about ');
  result = result.replace(/\bwith respect to\b\s*/gi, 'about ');
  result = result.replace(/\bpertaining to\b\s*/gi, 'about ');
  result = result.replace(/\bin relation to\b\s*/gi, 'about ');
  result = result.replace(/\bin order to\b\s*/gi, 'to ');
  result = result.replace(/\bdue to the fact that\b\s*/gi, 'because ');
  result = result.replace(/\bat your earliest convenience\b/gi, 'when you get a chance');
  result = result.replace(/\bmoving forward\b/gi, 'from here');
  result = result.replace(/\bgoing forward\b/gi, 'from here');
  result = result.replace(/\bfor your reference\b/gi, 'FYI');
  result = result.replace(/\bfor your records\b/gi, 'FYI');
  result = result.replace(/\bplease find attached\b/gi, "I've attached");
  result = result.replace(/\battached herewith\b/gi, "attached");
  result = result.replace(/\bdo let (?:me|us) know\b/gi, 'let me know');
  result = result.replace(/\bplease do let (?:me|us) know\b/gi, 'just let me know');
  result = result.replace(/\bshould you have any (?:further |additional )?questions?\b/gi, 'if you have any questions');
  result = result.replace(/\bif you require (?:any )?(?:further |additional )?(?:assistance|help)\b/gi, 'if you need anything else');
  result = result.replace(/\bif you need (?:any )?(?:further |additional )(?:assistance|help)\b/gi, 'if you need anything else');
  result = result.replace(/\bdo not hesitate\b/gi, 'feel free');
  result = result.replace(/\bnumerous\b/gi, 'a lot of');
  result = result.replace(/\bsufficient\b/gi, 'enough');
  result = result.replace(/\bnevertheless\b/gi, 'still');
  result = result.replace(/\bwhilst\b/gi, 'while');
  result = result.replace(/\bamongst\b/gi, 'among');
  result = result.replace(/\btowards\b/gi, 'toward');
  result = result.replace(/\bforward(?:ed)? (?:this |your )?(?:matter|issue|case|concern) to\b/gi, 'passed this to');
  result = result.replace(/\bescalated (?:this |your )?(?:matter|issue|case|concern) to\b/gi, 'flagged this with');
  result = result.replace(/\bat the present time\b/gi, 'right now');
  result = result.replace(/\bin the near future\b/gi, 'soon');
  result = result.replace(/\bin a timely manner\b/gi, 'quickly');
  result = result.replace(/\bin a timely fashion\b/gi, 'quickly');
  result = result.replace(/\btemporarily suspended\b/gi, 'paused for now');
  result = result.replace(/\bhas been temporarily\b/gi, 'has been');
  result = result.replace(/\bcomplete a quick identity verification\b/gi, 'do a quick ID check');
  result = result.replace(/\bidentity verification\b/gi, 'ID check');
  result = result.replace(/\bcomplete a quick\b/gi, 'do a quick');
  result = result.replace(/\bwe need to complete\b/gi, 'we need to do');
  result = result.replace(/\byour availability\b/gi, 'what times work for you');

  // Sign-offs
  result = result.replace(/\bBest regards,?\s*$/gim, 'Thanks,');
  result = result.replace(/\bWarm regards,?\s*$/gim, 'Thanks,');
  result = result.replace(/\bKind regards,?\s*$/gim, 'Thanks,');
  result = result.replace(/\bSincerely,?\s*$/gim, 'Thanks,');
  result = result.replace(/\bYours truly,?\s*$/gim, 'Thanks,');
  result = result.replace(/\bRespectfully,?\s*$/gim, 'Thanks,');
  result = result.replace(/\bWith (?:kind |warm |best )?regards,?\s*$/gim, 'Thanks,');

  // ── STEP 5: Contraction enforcement ──

  result = result.replace(/\bI am\b/g, "I'm");
  result = result.replace(/\bI have\b(?! to| a | an | any | no | the | my | your | been)/g, "I've");
  result = result.replace(/\bI will\b/g, "I'll");
  result = result.replace(/\bI would\b/g, "I'd");
  result = result.replace(/\bwe are\b/gi, "we're");
  result = result.replace(/\bwe have\b(?! to| a | an | any | no | the | our | been)/gi, "we've");
  result = result.replace(/\bwe will\b/gi, "we'll");
  result = result.replace(/\bwe would\b/gi, "we'd");
  result = result.replace(/\byou are\b/gi, "you're");
  result = result.replace(/\byou will\b/gi, "you'll");
  result = result.replace(/\byou would\b/gi, "you'd");
  result = result.replace(/\bthat is\b/gi, "that's");
  result = result.replace(/\bit is\b/gi, "it's");
  result = result.replace(/\bit will\b/gi, "it'll");
  result = result.replace(/\bthere is\b/gi, "there's");
  result = result.replace(/\bdo not\b/gi, "don't");
  result = result.replace(/\bdoes not\b/gi, "doesn't");
  result = result.replace(/\bdid not\b/gi, "didn't");
  result = result.replace(/\bcannot\b/gi, "can't");
  result = result.replace(/\bcan not\b/gi, "can't");
  result = result.replace(/\bwill not\b/gi, "won't");
  result = result.replace(/\bwould not\b/gi, "wouldn't");
  result = result.replace(/\bshould not\b/gi, "shouldn't");
  result = result.replace(/\bcould not\b/gi, "couldn't");
  result = result.replace(/\bhas not\b/gi, "hasn't");
  result = result.replace(/\bhave not\b/gi, "haven't");
  result = result.replace(/\bis not\b/gi, "isn't");
  result = result.replace(/\bare not\b/gi, "aren't");
  result = result.replace(/\bwas not\b/gi, "wasn't");
  result = result.replace(/\bwere not\b/gi, "weren't");
  result = result.replace(/\blet us\b/gi, "let's");

  // ── STEP 6: Punctuation ──

  // Semicolons → periods
  result = result.replace(/;\s*/g, '. ');

  // Em dashes → " - "
  result = result.replace(/\s*—\s*/g, ' - ');

  // Exclamation marks — allow max 2
  let exclamationCount = 0;
  result = result.replace(/!/g, () => {
    exclamationCount++;
    return exclamationCount <= 2 ? '!' : '.';
  });

  // ── STEP 7: Cleanup (2 passes to catch nested artifacts) ──

  for (let pass = 0; pass < 2; pass++) {
    result = result.replace(/  +/g, ' ');
    result = result.replace(/^ +/gm, '');
    result = result.replace(/\.\.+\s*/g, '. ');
    result = result.replace(/^,\s*/gm, '');
    result = result.replace(/\.\s*,\s*/g, '. ');
    result = result.replace(/,\s*,/g, ',');
    result = result.replace(/ - \./g, '.');
    result = result.replace(/ -\s*$/gm, '');
    result = result.replace(/^\.\s+/gm, '');
    result = result.replace(/^!\s*/gm, '');
    result = result.replace(/\.\s*\./g, '.');
    result = result.replace(/\b(but|and|or|so) ([A-Z])([a-z])/g, (_, conj, first, rest) => conj + ' ' + first.toLowerCase() + rest);
    result = result.replace(/\. ([a-z])/g, (_, c) => '. ' + c.toUpperCase());
    result = result.replace(/^([a-z])/gm, (_, c) => c.toUpperCase());
  }

  result = result.replace(/\n{3,}/g, '\n\n');
  result = result.replace(/[ \t]+$/gm, '');

  return result;
}

module.exports = { humanizeText };
