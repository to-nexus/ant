/**
 * Human-readable ID generator
 *
 * Generates 3-word hyphenated IDs (adjective-verb-noun) for use as
 * session IDs and job IDs. ~16.7M combinations (256^3).
 * Uses crypto.getRandomValues (works in both Node and browser).
 */

const ADJECTIVES = [
  'amber','ancient','arctic','autumn','azure','bitter','blazing','bold','brave','bright',
  'broad','bronze','calm','cedar','chilly','civil','clean','clear','clever','close',
  'cold','cool','coral','cosmic','cozy','crisp','cubic','cyan','dark','dawn',
  'deep','dense','dim','double','dry','dull','dusk','dusty','eager','early',
  'elder','ember','empty','equal','even','extra','faint','fair','far','fast',
  'fatal','fern','fierce','final','fine','firm','first','fixed','flat','fleet',
  'flint','focal','fond','forge','fossil','frank','fresh','front','frost','full',
  'gentle','giant','glad','glass','gleam','global','gold','grand','grave','great',
  'green','grey','grim','hazy','heavy','hidden','high','hollow','honey','humble',
  'icy','idle','inner','iron','ivory','jade','jolly','keen','kind','lapis',
  'large','late','lean','level','light','lime','live','local','lone','long',
  'lost','loud','low','lucky','lunar','major','maple','marble','marine','matte',
  'meek','mellow','metal','mild','mint','misty','mocha','modern','mossy','muted',
  'narrow','native','navy','near','neat','noble','north','novel','oak','oaken',
  'oat','ocean','olive','onyx','open','opal','orbit','outer','oval','pale',
  'palm','pastel','peak','pearl','pine','pixel','plain','plum','polar','prime',
  'proud','pure','quick','quiet','rapid','rare','raw','ready','real','red',
  'rich','rigid','ripe','river','rocky','rosy','round','royal','ruby','rural',
  'rusty','safe','sage','sandy','satin','sharp','sheer','short','shy','silk',
  'silver','simple','slate','sleek','slim','slow','small','smart','smooth','snowy',
  'soft','solar','solid','south','spare','stark','steady','steel','steep','still',
  'stone','stout','such','sunny','super','sure','sweet','swift','tall','tame',
  'tan','tart','teal','thick','thin','third','tidy','tight','timber','tiny',
  'topaz','total','tough','trim','true','tulip','ultra','upper','urban','valid',
  'vast','velvet','vivid','warm','wax','west','whole','wide','wild','wise',
  'young','zero','zinc','zonal','agile','alert',
];

const VERBS = [
  'asking','baking','banking','barking','basing','bearing','beating','being','bending','binding',
  'biting','blazing','blending','blessing','blocking','blowing','boiling','bolting','bonding','booking',
  'boxing','bracing','braiding','braking','brewing','bridging','bringing','brushing','building','burning',
  'buying','calling','calming','camping','caring','carving','casting','catching','causing','chasing',
  'checking','choking','choosing','circling','clapping','clearing','climbing','clinging','closing','coating',
  'coiling','combing','coming','cooking','cooling','copying','costing','counting','cracking','crafting',
  'crating','crossing','crushing','curbing','curling','cutting','cycling','dancing','daring','darting',
  'dashing','dawning','dealing','digging','dimming','dining','dipping','diving','doing','dosing',
  'dotting','drafting','draping','drawing','dreaming','drifting','driving','dropping','drying','dueling',
  'dusting','dyeing','earning','eating','edging','ending','evening','exiting','facing','fading',
  'falling','fanning','farming','fasting','feeding','feeling','fencing','filing','filling','finding',
  'firing','fishing','fitting','fixing','flaking','flaring','flashing','fleeing','flexing','flipping',
  'floating','flowing','flying','folding','forcing','forging','forming','framing','fronting','fueling',
  'fusing','gaining','gazing','getting','giving','glaring','glazing','gliding','glowing','going',
  'grading','grasping','grazing','grilling','grinding','gripping','growing','guarding','guiding','halting',
  'handing','hanging','hauling','heading','healing','hearing','heating','helping','herding','hiding',
  'hiking','hinting','hitting','holding','hoping','hosting','housing','hunting','icing','idling',
  'imaging','ironing','issuing','jetting','joining','jolting','judging','jumping','keeping','kicking',
  'killing','kiting','knitting','knowing','lacing','landing','lapping','lasting','laying','leading',
  'leaning','leaping','leaving','lending','lifting','lining','linking','listing','living','loading',
  'locking','lodging','logging','longing','looking','looping','losing','loving','making','mapping',
  'marking','mashing','meeting','melting','mending','merging','milling','mining','missing','mixing',
  'moaning','molding','mooring','morning','mossing','mounding','mounting','moving','mulling','naming',
  'nearing','nesting','netting','nodding','nosing','nothing','nursing','oaring','opening','orbiting',
  'pacing','packing','padding','pairing','parking','parsing','passing','pasting','patching','paving',
  'peaking','peeling','picking','piling','pinning',
];

const NOUNS = [
  'acorn','adder','agate','alarm','album','alder','algae','alpha','amber','angel',
  'anvil','apple','apron','arbor','arrow','aspen','atlas','badge','basin','batch',
  'beach','beads','bench','birch','blade','blaze','block','bloom','bluff','board',
  'bolt','booth','bough','brace','brain','brass','bread','brick','bride','brook',
  'brush','cabin','cairn','camel','canal','canon','cargo','cedar','chain','chalk',
  'charm','chess','chief','chord','churn','claim','clasp','cliff','cloak','clock',
  'cloud','coach','coral','couch','court','crane','crate','crest','cross','crowd',
  'crown','crush','crypt','curve','cycle','delta','depth','derby','digit','diver',
  'dodge','doubt','draft','drain','drake','drape','dream','drift','drill','drive',
  'drone','dryad','dwarf','eagle','ember','epoch','fable','facet','faith','feast',
  'fence','ferry','fiber','field','finch','flame','flare','flask','flint','float',
  'flock','flood','floor','flour','flute','folio','forge','forum','frost','fruit',
  'gavel','ghost','glade','glare','gleam','globe','glove','golem','goose','gorge',
  'grace','grain','grape','grasp','grass','grate','grove','guard','guild','gully',
  'haven','heart','hedge','helix','heron','hinge','holly','honor','horse','house',
  'ingot','inlet','ivory','jewel','joust','judge','kayak','knack','knave','kneel',
  'knife','knoll','label','lance','latch','lathe','ledge','lemon','level','lever',
  'light','lilac','linen','llama','lodge','locus','lotus','mango','manor','maple',
  'marsh','mason','medal','melon','merit','metal','milky','minty','mirth','mocha',
  'model','moose','motif','mound','mouse','mulch','mural','noble','north','notch',
  'novel','nurse','ocean','omega','onion','orbit','organ','otter','ozone','paint',
  'panel','panda','patch','pearl','penny','perch','photo','piano','pilot','pixel',
  'plank','plant','plaza','plier','plumb','plume','poach','point','polar','poppy',
  'pouch','prawn','prism','proof','prowl','pulse','quail','qualm','queen','quest',
  'quilt','quota','raven','reach','realm','ridge','rivet','robin','rover','rugby',
  'sable','scale','scene','scone','scout','shard','shelf',
];

export function generateHumanId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const adj = ADJECTIVES[((bytes[0] << 8) | bytes[1]) % ADJECTIVES.length];
  const verb = VERBS[((bytes[2] << 8) | bytes[3]) % VERBS.length];
  const noun = NOUNS[((bytes[4] << 8) | bytes[5]) % NOUNS.length];
  return `${adj}-${verb}-${noun}`;
}

/**
 * 2-word mnemonic (adjective-noun) for short identifiers — e.g. spec
 * filename disambiguation when an LLM-chosen slug already exists on disk.
 * Reuses the same dictionaries as generateHumanId() to keep one SSOT.
 */
export function generateMnemonic(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const adj = ADJECTIVES[((bytes[0] << 8) | bytes[1]) % ADJECTIVES.length];
  const noun = NOUNS[((bytes[2] << 8) | bytes[3]) % NOUNS.length];
  return `${adj}-${noun}`;
}
