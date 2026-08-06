const PLACEHOLDER_LINK = "https://example.com/invite";

const TONES = {
  friendly: {
    openings: [
      "Hey 👋 most solo creators are missing this…",
      "Hey 👋 worth a 20-second read — especially if your account matters to you.",
      "Hey 👋 I'll keep this short, but you might be leaving perks on the table.",
      "Hey there 👋 something our creators get that a lot of people don't…",
      "Hey 👋 quick one — this is what a lot of LIVE creators wish they'd sorted sooner.",
      "Hey 👋 random question — are you going LIVE without proper backing?",
    ],
    perkIntros: ["What you get:", "We offer:", "Perks include:", "You'd get:"],
    agency: {
      hooks: [
        (n) =>
          `I'm recruiting for ${n} and one of the biggest things we give creators is real account protection — a lot of people going LIVE solo don't have that.`,
        (n) =>
          `Quick one from ${n} — if you're going LIVE without account protection and proper backing, you're honestly missing out on stuff that keeps creators safer and growing.`,
        (n) =>
          `I'm looking for a few more creators for ${n}. Not a mass add — people who want account protection, real support, and perks most solo creators never get.`,
        (n) =>
          `Have you ever thought about joining a LIVE agency that actually protects your account and supports you properly? I'm recruiting for ${n}, but keeping it selective.`,
        (n) =>
          `You look like someone who could do well on LIVE with the right setup. At ${n} our creators get account protection and backing most people don't even realise they're missing.`,
        (n) =>
          `Are you currently in a LIVE agency? If not, you might be missing account protection and the kind of support ${n} builds around its creators.`,
        (n) =>
          `I'm reaching out for ${n} because spots with proper account protection + creator support don't stay open forever — and I think you'd be a strong fit.`,
        (n) =>
          `Curious if you've got proper account protection when you LIVE? ${n} is recruiting a small number of creators and that's one of the first things we sort.`,
        (n) =>
          `I'm recruiting a few creators into ${n}. If you're grinding LIVE without protection, battles set up for you, and real guidance — you're missing what our roster already has.`,
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
        (r) =>
          `I'm recruiting for ${r.full} — our creators get real account protection, and a lot of people going LIVE solo are missing that.`,
        (r) =>
          `Quick one from ${r.primary}. If you're LIVE without account protection and proper team backing, you're leaving a lot on the table.`,
        (r) =>
          `I'm scouting for ${r.full} and looking for creators who want more than a name on a list — account protection, support, and perks most people don't get.`,
        (r) =>
          `Have you thought about joining a LIVE team that actually protects your account? I'm recruiting for ${r.full}, but keeping it selective.`,
        (r) =>
          `You look like you'd do well on LIVE with the right setup. At ${r.full} our creators get account protection and backing most solo creators never see.`,
        (r) =>
          `Curious if you've got proper account protection when you LIVE? ${r.full} is recruiting a small number of creators and that's one of the first things we sort.`,
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
      "Hey 👋 solo LIVE creators leave a lot on the table without the right setup.",
      "Hey — quick opportunity 👋 this is what a lot of LIVE creators are missing.",
      "Hey 👋 if you go LIVE solo, read this before you scroll past.",
      "Hey 👋 20 seconds — especially if you don't have proper backing yet.",
    ],
    perkIntros: ["Why join us:", "What you'll gain:", "Here's what's in it for you:", "The opportunity includes:"],
    agency: {
      hooks: [
        (n) =>
          `${n} is recruiting and the creators who join get real account protection plus backing most solo LIVErs never unlock — you stood out to me.`,
        (n) =>
          `I'm building ${n} with creators who want to grow fast. If you don't already have account protection and a team behind you, you're missing the edge our roster has.`,
        (n) =>
          `There's a real opportunity with ${n} right now — account protection, proper support, and perks that solo creators keep missing out on. Spots are selective.`,
        (n) =>
          `I run ${n}. We're looking for creators ready to take LIVE seriously — starting with account protection and the kind of backing that actually moves the needle.`,
        (n) =>
          `You've got potential on LIVE — ${n} is recruiting people who want account protection, growth support, and benefits most creators don't even know they're missing.`,
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
          `${r.full} is recruiting — account protection and real team backing included. If you're still going LIVE without that, you're missing what our creators already have.`,
        (r) =>
          `There's a real opportunity with ${r.primary}: account protection, growth support, and perks solo creators keep missing. You'd be a strong fit.`,
        (r) =>
          `I'm scouting for ${r.full}. Looking for creators ready to take LIVE seriously — starting with protection and support most people never get.`,
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
      "Hello 👋 — reaching out about creator support many LIVE creators overlook.",
      "Hi there — a brief note on benefits you may not currently have in place.",
      "Hello, hope you're well. This may be relevant if you go LIVE without formal backing.",
      "Good day — a short note on provisions independent LIVE creators often go without.",
    ],
    perkIntros: ["Benefits include:", "The role includes:", "Support provided:", "Included as standard:"],
    agency: {
      hooks: [
        (n) =>
          `I'm recruiting for ${n} and wanted to flag that our creators receive account protection and structured support — benefits many independent LIVE creators are currently without.`,
        (n) =>
          `I'm contacting a select group regarding ${n}. If you do not already have account protection and ongoing guidance, you may be missing provisions our roster considers standard.`,
        (n) =>
          `${n} is expanding its creator roster. Priority benefits include account protection and professional support that solo creators often lack access to.`,
        (n) =>
          `I represent ${n}. We're seeking dedicated LIVE creators who want account protection, clear guidance, and a proper network behind them — rather than operating unsupported.`,
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
          `I'm reaching out on behalf of ${r.full}. Our creators receive account protection and structured support — benefits many independent LIVE creators currently go without.`,
        (r) =>
          `I'm recruiting for ${r.primary}. If you lack account protection and ongoing team guidance, you may be missing support our creators treat as standard.`,
        (r) =>
          `${r.full} is expanding. We're contacting a select group about joining — with account protection and professional backing included.`,
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
      "hey 👋 random but you might be missing out on this",
      "heyyy 👋 quick one — loads of people don't have this sorted",
      "yo 👋 most people going LIVE solo don't have this sorted",
      "hey 👋 worth a sec if your account matters to you",
      "hey there 👋 creators on our side get stuff a lot of people don't",
    ],
    perkIntros: ["you'd get:", "we've got:", "perks:", "stuff you get:"],
    agency: {
      hooks: [
        (n) =>
          `random but i'm recruiting for ${n} and our creators get real account protection — lowkey something loads of people miss out on`,
        (n) =>
          `not gonna lie if you're LIVEing without account protection + proper backing you're missing what ${n} already gives its creators`,
        (n) =>
          `basically recruiting for ${n} rn — account protection, support, the lot. most solo creators don't even realise they're missing it`,
        (n) =>
          `do you go LIVE much? asking cos ${n} is looking for creators and one of the first things we sort is account protection`,
        (n) =>
          `honestly think you'd be a good fit for ${n} — especially if you don't already have account protection and a proper crew behind you`,
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
        (r) =>
          `random but i'm scouting for ${r.full} — our creators get account protection and most people going LIVE solo don't have that`,
        (r) =>
          `basically recruiting for ${r.primary} rn. if you don't have account protection + proper backing you're missing what the team already offers`,
        (r) =>
          `honestly think you'd fit ${r.full} — especially if account protection and real support aren't sorted for you yet`,
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
        (n) =>
          `Recruiting for ${n}. Creators get account protection — most solo LIVErs don't. Details below.`,
        (n) =>
          `LIVE recruitment — ${n}. Account protection + real backing included. Quick overview:`,
        (n) =>
          `${n} is recruiting. If you don't have account protection yet, you're missing what our roster gets. Here's what you need to know:`,
        (n) =>
          `Looking for creators for ${n}. Big one: account protection and perks solo creators usually miss. Summary below.`,
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
        (r) =>
          `Recruiting for ${r.full}. Account protection included — most solo creators don't have it. Details below.`,
        (r) =>
          `LIVE recruitment — ${r.primary}. Account protection + team backing. Overview:`,
        (r) =>
          `Scouting for ${r.full}. If you lack account protection, you're missing what our creators get. Summary below.`,
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
  protection: [
    "Account protection",
    "Real account protection",
    "Account protection most solo creators don't get",
  ],
  support: ["Help, support and guidance", "Support and guidance", "Proper support so you're not figuring LIVE out alone"],
  battles: ["Arranged battles if you want them", "Arranged battles"],
  bonus: ["Bonus £ opportunities", "Bonus £ opportunities a lot of creators miss out on"],
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
  if (!trimmed) return "my LIVE agency";
  if (/agency/i.test(trimmed)) return trimmed;
  return `${trimmed}'s LIVE agency`;
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
    primary: "the LIVE team I scout for",
    full: "the LIVE team I scout for",
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
