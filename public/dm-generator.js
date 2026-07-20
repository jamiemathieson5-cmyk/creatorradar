const PLACEHOLDER_LINK = "https://www.tiktok.com/t/ZSxdaxR9M/";

const TONES = {
  friendly: {
    openings: [
      "Hey, hope you're good! 👋",
      "Hey 👋",
      "Hey there 👋",
      "Hey 👋 quick one —",
      "Hey, random question 👋",
      "Hey 👋 I'll keep this short.",
    ],
    perkIntros: ["What you get:", "We offer:", "Perks include:", "You'd get:"],
    agency: {
      hooks: [
        (n) => `I'm currently recruiting for ${n} and thought you might be a good fit!`,
        (n) => `I'm currently looking for a few more creators to join ${n}.`,
        (n) => `I'm recruiting creators for ${n} and I think you'd be a strong fit.`,
        (n) =>
          `I'm recruiting a few creators into ${n}, but I'm not mass adding people. I'm looking for people who actually go LIVE and want proper support around them.`,
        (n) =>
          `Have you ever thought about joining a TikTok LIVE agency that actually supports creators properly? I'm recruiting for ${n} at the moment, but I'm keeping it selective.`,
        (n) =>
          `You look like someone who could do well on TikTok LIVE with the right support around you. I run ${n} and I'm looking for creators who want more than just being added to a list and forgotten about.`,
        (n) =>
          `Are you currently in a TikTok LIVE agency? I'm recruiting creators into ${n} and thought you might be a good fit.`,
        (n) =>
          `I'm reaching out to a small number of creators who I think could fit well in ${n}. We're not trying to sign everyone.`,
        (n) =>
          `Quick question — do you go LIVE much on TikTok? I'm recruiting for ${n} and I think you could be a really good fit.`,
      ],
      community: [
        "We're building an actual community and family on the app, not just another agency that brings on creators and forgets all about them.",
        "This isn't one of those agencies that just signs people up and leaves them to figure it out.",
        "We're not trying to sign everyone — we're building a proper creator community.",
        "It's more of a creator community/family than just another agency.",
        "It's not just an agency, it's more of a community where creators actually get supported and looked after.",
      ],
      closings: [
        (link) =>
          `No pressure at all, but if you're interested in joining, here's the link:\n${link}`,
        (link) =>
          `No pressure at all, but I genuinely think you could be a good fit. Apply here if you're interested:\n${link}`,
        (link) =>
          `No pressure, but if you want to be part of an agency that actually supports its creators, apply here:\n${link}`,
        (link) =>
          `No pressure at all, but you look like someone who could fit in well. Apply here:\n${link}`,
        (link) =>
          `No pressure, but I thought you'd be worth reaching out to. Apply here:\n${link}`,
      ],
    },
    team: {
      hooks: [
        (r) => `I'm currently recruiting creators for ${r.full} and thought you might be a good fit!`,
        (r) => `I'm looking for a few more creators to join ${r.primary}.`,
        (r) => `I'm scouting for ${r.full} and I think you'd be a strong fit.`,
        (r) =>
          `Have you ever thought about joining a TikTok LIVE team that actually supports creators properly? I'm recruiting for ${r.full} at the moment, but I'm keeping it selective.`,
        (r) =>
          `You look like someone who could do well on TikTok LIVE with the right support around you. I'm part of ${r.full} and we're looking for creators who want more than just being added to a list and forgotten about.`,
        (r) =>
          `Quick question — do you go LIVE much on TikTok? I'm recruiting for ${r.full} and I think you could be a really good fit.`,
      ],
      community: [
        "We're building an actual community and family on the app, not just another team that brings on creators and forgets all about them.",
        "It's more of a creator community/family than just another scouting team.",
        "We're not just signing people and forgetting about them — the team genuinely supports its creators.",
      ],
      closings: [
        (link) =>
          `No pressure at all, but if you're interested in joining the team, here's the link:\n${link}`,
        (link) =>
          `No pressure at all, but I genuinely think you could be a good fit. Apply here if you're interested:\n${link}`,
        (link) =>
          `No pressure, but if you want to join a team that actually supports its creators, apply here:\n${link}`,
      ],
    },
  },
  sales: {
    openings: [
      "Hey 👋 got a minute?",
      "Hey — quick opportunity 👋",
      "Hey 👋 this could be a great fit for you.",
      "Hey 👋 I'll keep this short — worth a read.",
    ],
    perkIntros: ["Why join us:", "What you'll gain:", "Here's what's in it for you:", "The opportunity includes:"],
    agency: {
      hooks: [
        (n) =>
          `I'm actively building ${n} and looking for creators who want to grow fast on TikTok LIVE — you stood out to me.`,
        (n) =>
          `${n} is recruiting right now and I genuinely think you'd be a strong addition. This isn't a mass add — we're being selective.`,
        (n) =>
          `There's a real opportunity with ${n} for creators who go LIVE consistently and want proper backing behind them.`,
        (n) =>
          `I run ${n} and we're looking for creators who are ready to take TikTok LIVE seriously with the right support behind them.`,
        (n) =>
          `You've got potential on LIVE — ${n} is recruiting creators who want to turn that into real growth.`,
      ],
      community: [
        "This is a chance to join an agency that actually invests in its creators — not just adds names to a list.",
        "We're building something worth being part of, and we're selective about who we bring on.",
        "Most agencies sign you up and disappear. We do the opposite — we're in it for the long run with our creators.",
      ],
      closings: [
        (link) => `If this sounds like your kind of opportunity, apply here:\n${link}`,
        (link) => `Worth a look if you're serious about LIVE — apply here:\n${link}`,
        (link) => `Spots are limited — grab yours here if you're interested:\n${link}`,
        (link) => `Don't miss out — apply here:\n${link}`,
      ],
    },
    team: {
      hooks: [
        (r) =>
          `${r.full} is recruiting creators right now — and you'd be a strong fit based on what I've seen.`,
        (r) =>
          `There's a real opportunity with ${r.primary} for creators who want to grow on TikTok LIVE with proper support.`,
        (r) =>
          `I'm scouting for ${r.full} and looking for creators who are ready to take LIVE seriously.`,
      ],
      community: [
        "This is a chance to join a team that actually backs its creators — not just another scouting group chasing numbers.",
        "We're building something worth being part of, and we're picky about who we add.",
      ],
      closings: [
        (link) => `If this sounds like your kind of opportunity, apply here:\n${link}`,
        (link) => `Worth a look — apply here:\n${link}`,
        (link) => `Spots are limited — apply here:\n${link}`,
      ],
    },
  },
  professional: {
    openings: [
      "Hello 👋",
      "Hi there,",
      "Good day —",
      "Hello, hope you're well.",
    ],
    perkIntros: ["Benefits include:", "The role includes:", "Support provided:", "Included as standard:"],
    agency: {
      hooks: [
        (n) =>
          `I'm reaching out regarding a creator recruitment opportunity with ${n} and believe you may be a suitable fit.`,
        (n) =>
          `I'm currently recruiting creators for ${n}. Your profile stood out and I'd like to share the details with you.`,
        (n) =>
          `${n} is expanding its creator roster and I'm contacting a select group of creators, including yourself.`,
        (n) =>
          `I represent ${n} and we're looking for dedicated TikTok LIVE creators to join our programme.`,
      ],
      community: [
        "We focus on building a structured, supportive environment — not simply onboarding creators without ongoing guidance.",
        "Our approach centres on long-term creator development and a professional network behind you.",
        "We take a hands-on approach with every creator we bring on — not a sign-up-and-forget model.",
      ],
      closings: [
        (link) => `Please find the application link below if you'd like to learn more:\n${link}`,
        (link) => `If you're interested, you can apply here:\n${link}`,
        (link) => `Further details and application:\n${link}`,
      ],
    },
    team: {
      hooks: [
        (r) =>
          `I'm reaching out on behalf of ${r.full} regarding a creator recruitment opportunity.`,
        (r) =>
          `I'm recruiting creators for ${r.primary} and your profile appears to be a suitable match.`,
        (r) =>
          `${r.full} is expanding and I'm contacting a select group of creators to discuss joining.`,
      ],
      community: [
        "We operate as a dedicated scouting team with structured follow-up — not simply adding creators and moving on.",
        "Our team takes a long-term view with every creator we bring on.",
      ],
      closings: [
        (link) => `Please find the application link below if you'd like to learn more:\n${link}`,
        (link) => `If you're interested, you can apply here:\n${link}`,
      ],
    },
  },
  casual: {
    openings: [
      "hey 👋",
      "heyyy 👋",
      "yo 👋",
      "hey, random one 👋",
      "hey there 👋",
    ],
    perkIntros: ["you'd get:", "we've got:", "perks:", "stuff you get:"],
    agency: {
      hooks: [
        (n) => `random but i'm recruiting for ${n} and you look like you'd fit in tbh`,
        (n) => `not gonna lie you look like you'd smash LIVE — we're recruiting for ${n}`,
        (n) => `basically recruiting for ${n} rn and thought i'd reach out to you`,
        (n) => `do you go LIVE much? asking cos we're looking for creators for ${n}`,
        (n) => `honestly think you'd be a good fit for ${n} — just putting it out there`,
      ],
      community: [
        "it's not one of those agencies that signs you and ghosts — we're actually building a proper community",
        "basically more of a family vibe than a typical agency if that makes sense",
        "we're chill but we actually look after our creators properly",
      ],
      closings: [
        (link) => `no stress at all but here's the link if you're curious:\n${link}`,
        (link) => `only if you're interested — link's here:\n${link}`,
        (link) => `no pressure btw, apply here if you fancy it:\n${link}`,
      ],
    },
    team: {
      hooks: [
        (r) => `random but i'm scouting for ${r.full} and you look like you'd fit in`,
        (r) => `basically recruiting for ${r.primary} rn and thought i'd reach out`,
        (r) => `honestly think you'd be a good fit for ${r.full} — just putting it out there`,
      ],
      community: [
        "it's not just numbers — we're actually building a decent community around the team",
        "chill vibe but we actually support our creators properly",
      ],
      closings: [
        (link) => `no stress, link's here if you're curious:\n${link}`,
        (link) => `no pressure — apply here if you fancy it:\n${link}`,
      ],
    },
  },
  direct: {
    openings: [],
    perkIntros: ["Included:", "You get:", "What's included:", "Package:"],
    agency: {
      hooks: [
        (n) => `Recruiting creators for ${n}. Details below.`,
        (n) => `TikTok LIVE recruitment — ${n}. Quick overview:`,
        (n) => `${n} is recruiting. Here's what you need to know:`,
        (n) => `Looking for creators to join ${n}. Summary below if interested.`,
      ],
      community: [
        "We're selective — not mass adding. Community-focused, not sign-and-forget.",
        "Small roster, proper backing — that's the model.",
      ],
      closings: [
        (link) => `Apply here:\n${link}`,
        (link) => `Link to apply:\n${link}`,
        (link) => `Interested? Apply:\n${link}`,
      ],
    },
    team: {
      hooks: [
        (r) => `Recruiting for ${r.full}. Details below.`,
        (r) => `TikTok LIVE recruitment — ${r.primary}. Overview:`,
        (r) => `Scouting creators for ${r.full}. Summary below.`,
      ],
      community: [
        "Selective recruitment — not mass adding.",
        "Small team, focused on creators who actually go LIVE.",
      ],
      closings: [
        (link) => `Apply here:\n${link}`,
        (link) => `Link to apply:\n${link}`,
      ],
    },
  },
};

const VALID_TONES = Object.keys(TONES);

function getPools(roleType, tone) {
  const tonePack = TONES[VALID_TONES.includes(tone) ? tone : "friendly"];
  const rolePack = tonePack[roleType];
  return {
    openings: tonePack.openings,
    hooks: rolePack.hooks,
    community: rolePack.community,
    closings: rolePack.closings,
    perkIntros: tonePack.perkIntros,
  };
}

const PERK_CATEGORIES = {
  protection: ["Account protection", "Real account protection"],
  support: ["Help, support and guidance", "Support and guidance"],
  battles: ["Arranged battles if you want them", "Arranged battles"],
  bonus: ["Bonus £ opportunities"],
  discord: ["Private Discord community", "Access to our private Discord"],
  group: ["A safe, supportive group/family on the app"],
};

const PERK_INTROS_DEFAULT = ["What you get:", "We offer:", "Perks include:", "You'd get:"];

const REQUIREMENT_FORMATS = [
  () =>
    `Minimum requirements:\n🔞 Must be 18+\n📅 8 LIVE days per month\n⏰ 20 LIVE hours per month`,
  () =>
    `Minimum requirements are:\n• 18+ only\n• 8 LIVE days per month\n• 20 LIVE hours per month`,
  () =>
    `Minimum requirements are simple:\n🔞 18+\n📅 8 LIVE days per month\n⏰ 20 LIVE hours per month`,
  () =>
    `Requirements are simple:\n• 18+\n• 8 LIVE days per month\n• 20 LIVE hours per month`,
  () => `Requirements:\n• 18+\n• 8 LIVE days/month\n• 20 LIVE hours/month`,
  () =>
    `You only need to be:\n• 18+\n• LIVE 8 days per month\n• Do 20 LIVE hours per month`,
  () =>
    `Only requirements:\n• 18+\n• 8 LIVE days per month\n• 20 LIVE hours per month`,
];

const INLINE_PERK_TEMPLATES = [
  (items, intro) => `${intro} ${joinInline(items)}.`,
  (items, intro) => `${intro} ${joinInline(items)} — all part of the package.`,
  (items) => joinInline(items) + ".",
];

function getMentionedTopicIds(text) {
  const lower = text.toLowerCase();
  const ids = new Set();
  if (/account protection|\bprotection\b/.test(lower)) ids.add("protection");
  if (/support|guidance/.test(lower)) ids.add("support");
  if (/battle/.test(lower)) ids.add("battles");
  if (/bonus|£/.test(lower)) ids.add("bonus");
  if (/discord/.test(lower)) ids.add("discord");
  if (/group\/family|safe group|supportive group/.test(lower)) ids.add("group");
  return ids;
}

function lineListsPerks(line) {
  if (/✅|what you get|we offer:|perks include|you'd get:|benefits include|included:/i.test(line)) {
    return true;
  }
  const topics = getMentionedTopicIds(line);
  return topics.size >= 2;
}

function pickUniquePerks(excludedTopics, count) {
  const categories = shuffle(Object.keys(PERK_CATEGORIES));
  const picked = [];

  for (const category of categories) {
    if (excludedTopics.has(category)) continue;
    picked.push(pick(PERK_CATEGORIES[category]));
    if (picked.length >= count) break;
  }

  return picked;
}

function hasRepeatedPerkTopics(text) {
  const lower = text.toLowerCase();
  const countMatches = (pattern) => (lower.match(pattern) || []).length;

  return (
    countMatches(/discord/g) > 1 ||
    countMatches(/account protection/g) > 1 ||
    countMatches(/bonus £/g) > 1 ||
    countMatches(/arranged battle/g) > 1 ||
    countMatches(/support and guidance|help, support/g) > 1 ||
    countMatches(/private discord/g) > 1
  );
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function joinInline(items) {
  if (items.length <= 1) return items[0] || "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function formatAgencyName(name) {
  const trimmed = name.trim();
  if (!trimmed) return "my TikTok LIVE agency";
  if (/agency/i.test(trimmed)) return trimmed;
  return `${trimmed}'s TikTok LIVE agency`;
}

function buildTeamReference(teamName, agencyName) {
  const team = teamName.trim();
  const agency = agencyName.trim();

  if (team && agency) {
    return {
      primary: `${team} at ${agency}`,
      full: `${team}, the team at ${agency}`,
    };
  }
  if (team) return { primary: team, full: team };
  if (agency) return { primary: `the team at ${agency}`, full: `the team at ${agency}` };
  return {
    primary: "the TikTok LIVE team I scout for",
    full: "the TikTok LIVE team I scout for",
  };
}

function formatChecklist(perks, perkIntros) {
  const intro = pick(perkIntros.length ? perkIntros : PERK_INTROS_DEFAULT);
  return `${intro}\n${perks.map((p) => `✅ ${p}`).join("\n")}`;
}

function formatInlinePerks(perks, perkIntros) {
  const intro = pick(perkIntros.length ? perkIntros : PERK_INTROS_DEFAULT);
  return pick(INLINE_PERK_TEMPLATES)(perks, intro);
}

function pickCommunityLine(communityLines, context, willIncludePerkBlock) {
  let options = communityLines;

  if (willIncludePerkBlock) {
    options = options.filter((line) => !lineListsPerks(line));
  }

  options = options.filter((line) => {
    const lineTopics = getMentionedTopicIds(line);
    const contextTopics = getMentionedTopicIds(context);
    for (const topic of lineTopics) {
      if (contextTopics.has(topic)) return false;
    }
    return true;
  });

  if (!options.length) options = communityLines.filter((line) => !lineListsPerks(line));
  if (!options.length) options = communityLines;

  return pick(options);
}

function buildMessage(link, nameRef, pools, structure) {
  const parts = [];
  let context = "";

  if (structure.useOpening && pools.openings.length > 0) {
    const opening = pick(pools.openings);
    parts.push(opening);
    context += `${opening} `;
  }

  const hook = pick(pools.hooks)(nameRef);
  parts.push(hook);
  context += `${hook} `;

  const perkCount = structure.perkStyle === "checklist" ? 5 : 4;
  const willIncludePerkBlock = true;

  if (structure.includeCommunity) {
    const community = pickCommunityLine(pools.community, context, willIncludePerkBlock);
    parts.push(community);
    context += `${community} `;
  }

  const mentioned = getMentionedTopicIds(context);
  const perks = pickUniquePerks(mentioned, perkCount);

  if (structure.perkStyle === "checklist") {
    parts.push(formatChecklist(perks, pools.perkIntros));
  } else {
    parts.push(formatInlinePerks(perks, pools.perkIntros));
  }

  parts.push(pick(REQUIREMENT_FORMATS)());
  parts.push(pick(pools.closings)(link));

  return parts.join("\n\n").replaceAll(PLACEHOLDER_LINK, link);
}

const STRUCTURES = [
  { useOpening: true, includeCommunity: true, perkStyle: "inline" },
  { useOpening: false, includeCommunity: true, perkStyle: "checklist" },
  { useOpening: true, includeCommunity: false, perkStyle: "checklist" },
  { useOpening: false, includeCommunity: true, perkStyle: "inline" },
  { useOpening: true, includeCommunity: true, perkStyle: "checklist" },
  { useOpening: false, includeCommunity: false, perkStyle: "inline" },
  { useOpening: true, includeCommunity: false, perkStyle: "inline" },
  { useOpening: false, includeCommunity: true, perkStyle: "checklist" },
];

function normalize(text) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function isTooSimilar(candidate, previousDMs) {
  const normalized = normalize(candidate);
  const firstLine = candidate.split("\n")[0];

  for (const prev of previousDMs) {
    if (normalize(prev) === normalized) return true;
    if (prev.split("\n")[0] === firstLine) return true;

    const wordsA = new Set(normalized.split(" ").slice(0, 20));
    const wordsB = new Set(normalize(prev).split(" ").slice(0, 20));
    let overlap = 0;
    wordsA.forEach((w) => {
      if (wordsB.has(w) && w.length > 3) overlap += 1;
    });
    if (overlap >= 14) return true;
  }

  return false;
}

function generateRecruitmentDM(settings, previousDMs = []) {
  const roleType = settings.roleType === "team" ? "team" : "agency";
  const link = (settings.scoutingLink || "").trim() || PLACEHOLDER_LINK;
  const pools = getPools(roleType, settings.tone);
  const nameRef =
    roleType === "team"
      ? buildTeamReference(settings.teamName || "", settings.parentAgencyName || "")
      : formatAgencyName(settings.agencyName || "");
  const structures = shuffle(STRUCTURES);
  let lastCandidate = "";

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const structure = structures[attempt % structures.length];
    const candidate = buildMessage(link, nameRef, pools, structure);
    lastCandidate = candidate;

    if (!isTooSimilar(candidate, previousDMs) && !hasRepeatedPerkTopics(candidate)) {
      return candidate;
    }
  }

  return lastCandidate;
}

/** Shared across DM Generator tab + lead Message button for variety. */
let sharedDmHistory = [];
const SHARED_MAX_HISTORY = 8;

function rememberGeneratedDm(dm) {
  if (!dm) return;
  sharedDmHistory = [dm, ...sharedDmHistory].slice(0, SHARED_MAX_HISTORY);
}

function readDmSettingsFromUiOrStorage() {
  const agencyNameInput = document.getElementById("dm-agency-name");
  const teamNameInput = document.getElementById("dm-team-name");
  const parentAgencyNameInput = document.getElementById("dm-parent-agency-name");
  const scoutingLinkInput = document.getElementById("dm-scouting-link");
  const messageToneSelect = document.getElementById("dm-message-tone");
  const root = document.getElementById("panel-dm");
  const selectedRole = root?.querySelector('input[name="dm-role-type"]:checked');

  if (agencyNameInput && messageToneSelect) {
    const tone = messageToneSelect.value;
    return {
      agencyName: agencyNameInput.value.trim(),
      teamName: (teamNameInput?.value || "").trim(),
      parentAgencyName: (parentAgencyNameInput?.value || "").trim(),
      scoutingLink: (scoutingLinkInput?.value || "").trim(),
      roleType: selectedRole?.value === "team" ? "team" : "agency",
      tone: VALID_TONES.includes(tone) ? tone : "friendly",
    };
  }

  const savedTone = loadSetting(STORAGE_KEYS.messageTone);
  const savedRole = loadSetting(STORAGE_KEYS.roleType);
  return {
    agencyName: loadSetting(STORAGE_KEYS.agencyName),
    teamName: loadSetting(STORAGE_KEYS.teamName),
    parentAgencyName: loadSetting(STORAGE_KEYS.parentAgencyName),
    scoutingLink: loadSetting(STORAGE_KEYS.scoutingLink),
    roleType: savedRole === "team" ? "team" : "agency",
    tone: VALID_TONES.includes(savedTone) ? savedTone : "friendly",
  };
}

/**
 * Public API for leads UI: generate using current DM Generator settings
 * (live form if present, else cookies/localStorage).
 */
window.CreatorRadarDM = {
  generateForLead(_opts = {}) {
    // Safe if DM tab init hasn't run yet; no-op after first migration.
    try {
      migrateLegacyLocalStorage();
    } catch {
      // Ignore.
    }
    const settings = readDmSettingsFromUiOrStorage();
    const dm = generateRecruitmentDM(settings, sharedDmHistory);
    rememberGeneratedDm(dm);
    return dm;
  },
  getSettings() {
    return readDmSettingsFromUiOrStorage();
  },
};


const COOKIE_PREFIX = "crdm_";
const COOKIE_DAYS = 365;
const LS_PREFIX = "creatorradar-dm:";

const STORAGE_KEYS = {
  agencyName: "agency-name",
  teamName: "team-name",
  parentAgencyName: "parent-agency-name",
  scoutingLink: "scouting-link",
  roleType: "role-type",
  messageTone: "message-tone",
};

const LEGACY_LOCAL_STORAGE_KEYS = {
  agencyName: "recruitment-dm-agency-name",
  teamName: "recruitment-dm-team-name",
  parentAgencyName: "recruitment-dm-parent-agency-name",
  scoutingLink: "recruitment-dm-scouting-link",
  roleType: "recruitment-dm-role-type",
  messageTone: "recruitment-dm-message-tone",
  apiKey: "recruitment-dm-api-key",
};

function cookiePath() {
  const path = window.location.pathname;
  const lastSlash = path.lastIndexOf("/");
  return lastSlash >= 0 ? path.slice(0, lastSlash + 1) : "/";
}

function setCookie(name, value, days = COOKIE_DAYS) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  const secure = window.location.protocol === "https:" ? ";Secure" : "";
  document.cookie = `${COOKIE_PREFIX}${encodeURIComponent(name)}=${encodeURIComponent(value)};expires=${expires};path=${cookiePath()};SameSite=Lax${secure}`;
}

function getCookie(name) {
  const key = `${COOKIE_PREFIX}${encodeURIComponent(name)}=`;
  const cookies = document.cookie.split("; ");
  for (const cookie of cookies) {
    if (cookie.startsWith(key)) {
      return decodeURIComponent(cookie.slice(key.length));
    }
  }
  return "";
}

function deleteCookie(name) {
  document.cookie = `${COOKIE_PREFIX}${encodeURIComponent(name)}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=${cookiePath()};SameSite=Lax`;
}

function loadSetting(key) {
  try {
    const fromCookie = getCookie(key);
    if (fromCookie) return fromCookie;
    return localStorage.getItem(LS_PREFIX + key) || "";
  } catch {
    return "";
  }
}

function saveSetting(key, value) {
  try {
    if (value) {
      setCookie(key, value);
      localStorage.setItem(LS_PREFIX + key, value);
    } else {
      deleteCookie(key);
      localStorage.removeItem(LS_PREFIX + key);
    }
  } catch {
    // Ignore persistence failures in restricted contexts.
  }
}

function migrateLegacyLocalStorage() {
  try {
    Object.entries(LEGACY_LOCAL_STORAGE_KEYS).forEach(([key, legacyKey]) => {
      const storageKey = STORAGE_KEYS[key];
      const legacyValue = localStorage.getItem(legacyKey);
      if (legacyValue && storageKey && !loadSetting(storageKey)) {
        saveSetting(storageKey, legacyValue);
      }
      localStorage.removeItem(legacyKey);
    });
  } catch {
    // Ignore migration failures.
  }
}

function initDmGenerator() {
  const root = document.getElementById("panel-dm");
  if (!root) return;

  const agencyFields = document.getElementById("dm-agency-fields");
  const teamFields = document.getElementById("dm-team-fields");
  const agencyNameInput = document.getElementById("dm-agency-name");
  const teamNameInput = document.getElementById("dm-team-name");
  const parentAgencyNameInput = document.getElementById("dm-parent-agency-name");
  const scoutingLinkInput = document.getElementById("dm-scouting-link");
  const messageToneSelect = document.getElementById("dm-message-tone");
  const roleTypeInputs = root.querySelectorAll('input[name="dm-role-type"]');
  const generateBtn = document.getElementById("dm-generate-btn");
  const generateAgainBtn = document.getElementById("dm-generate-again-btn");
  const resultEmpty = document.getElementById("dm-result-empty");
  const resultText = document.getElementById("dm-result-text");
  const copyBtn = document.getElementById("dm-copy-btn");
  const copyLabel = document.getElementById("dm-copy-label");

  if (!generateBtn || !agencyNameInput) return;

  let lastDM = "";

  function getRoleType() {
    const selected = root.querySelector('input[name="dm-role-type"]:checked');
    return selected?.value === "team" ? "team" : "agency";
  }

  function updateRoleUI() {
    const isTeam = getRoleType() === "team";
    agencyFields.classList.toggle("hidden", isTeam);
    teamFields.classList.toggle("hidden", !isTeam);
  }

  function getSettings() {
    return {
      agencyName: agencyNameInput.value.trim(),
      teamName: teamNameInput.value.trim(),
      parentAgencyName: parentAgencyNameInput.value.trim(),
      scoutingLink: scoutingLinkInput.value.trim(),
      roleType: getRoleType(),
      tone: messageToneSelect.value,
    };
  }

  function restoreSettings() {
    agencyNameInput.value = loadSetting(STORAGE_KEYS.agencyName);
    teamNameInput.value = loadSetting(STORAGE_KEYS.teamName);
    parentAgencyNameInput.value = loadSetting(STORAGE_KEYS.parentAgencyName);
    scoutingLinkInput.value = loadSetting(STORAGE_KEYS.scoutingLink);

    const savedTone = loadSetting(STORAGE_KEYS.messageTone);
    messageToneSelect.value = VALID_TONES.includes(savedTone) ? savedTone : "friendly";

    const savedRole = loadSetting(STORAGE_KEYS.roleType);
    const roleValue = savedRole === "team" ? "team" : "agency";
    roleTypeInputs.forEach((input) => {
      input.checked = input.value === roleValue;
    });

    updateRoleUI();
  }

  function persistSettings() {
    saveSetting(STORAGE_KEYS.agencyName, agencyNameInput.value.trim());
    saveSetting(STORAGE_KEYS.teamName, teamNameInput.value.trim());
    saveSetting(STORAGE_KEYS.parentAgencyName, parentAgencyNameInput.value.trim());
    saveSetting(STORAGE_KEYS.scoutingLink, scoutingLinkInput.value.trim());
    saveSetting(STORAGE_KEYS.roleType, getRoleType());
    saveSetting(STORAGE_KEYS.messageTone, messageToneSelect.value);
  }

  function resetCopyLabel() {
    copyLabel.textContent = "Copy DM";
    copyLabel.classList.remove("copy-success");
  }

  function showEmptyState() {
    resultEmpty.classList.remove("hidden");
    resultText.classList.add("hidden");
    copyBtn.disabled = true;
    generateAgainBtn.disabled = true;
  }

  function showResult(dm) {
    lastDM = dm;
    resultText.textContent = dm;
    resultText.classList.remove("is-loading", "is-error");
    resultText.scrollTop = 0;
    resultEmpty.classList.add("hidden");
    resultText.classList.remove("hidden");
    copyBtn.disabled = false;
    generateAgainBtn.disabled = false;
    resetCopyLabel();
  }

  function generateDM() {
    persistSettings();
    const dm = generateRecruitmentDM(getSettings(), sharedDmHistory);
    rememberGeneratedDm(dm);
    showResult(dm);
  }

  async function copyResult() {
    if (!lastDM) return;
    try {
      await navigator.clipboard.writeText(lastDM);
      copyLabel.textContent = "Copied!";
      copyLabel.classList.add("copy-success");
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = lastDM;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "absolute";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      copyLabel.textContent = "Copied!";
      copyLabel.classList.add("copy-success");
    }
  }

  agencyNameInput.addEventListener("input", persistSettings);
  teamNameInput.addEventListener("input", persistSettings);
  parentAgencyNameInput.addEventListener("input", persistSettings);
  scoutingLinkInput.addEventListener("input", persistSettings);
  messageToneSelect.addEventListener("change", persistSettings);
  roleTypeInputs.forEach((input) => {
    input.addEventListener("change", () => {
      updateRoleUI();
      persistSettings();
    });
  });
  generateBtn.addEventListener("click", generateDM);
  generateAgainBtn.addEventListener("click", generateDM);
  copyBtn.addEventListener("click", copyResult);

  migrateLegacyLocalStorage();
  restoreSettings();
  showEmptyState();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initDmGenerator);
} else {
  initDmGenerator();
}
