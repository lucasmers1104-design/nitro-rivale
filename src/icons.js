// Kräftige Symbole im Stil der Oberfläche (dunkle Kontur, bunte Flächen)
const S = (body, vb = '0 0 64 64') => `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg"><g stroke="#23264a" stroke-width="4" stroke-linejoin="round" stroke-linecap="round">${body}</g></svg>`;

export const ITEM_ICONS = {
  nitro: S('<rect x="19" y="17" width="26" height="41" rx="9" fill="#3fb7ff"/><rect x="25" y="6" width="14" height="12" rx="3" fill="#c9d3e6"/><path d="M35 23 L25 39 H32 L28 52 L40 34 H33 Z" fill="#fff" stroke-width="3"/>'),
  jump: S('<path d="M32 4 L50 22 H40 V32 H24 V22 H14 Z" fill="#7be05a"/><path d="M16 40 L48 44 L16 49 L48 53 L16 58" fill="none" stroke="#9aa3b8" stroke-width="5"/><path d="M16 40 L48 44 L16 49 L48 53 L16 58" fill="none" stroke-width="1.5" stroke="#23264a"/>'),
  rocket: S('<g transform="rotate(45 32 32)"><path d="M32 3 C41 11 43 23 43 36 H21 C21 23 23 11 32 3Z" fill="#f2efe8"/><path d="M21 28 L12 42 H21Z M43 28 L52 42 H43Z" fill="#e8483a"/><circle cx="32" cy="21" r="5" fill="#3fb7ff"/><path d="M25 38 L32 58 L39 38Z" fill="#ffb03a"/></g>'),
  barrel: S('<rect x="15" y="11" width="34" height="46" rx="7" fill="#e8483a"/><rect x="13" y="20" width="38" height="7" rx="2" fill="#ffd23e"/><rect x="13" y="41" width="38" height="7" rx="2" fill="#ffd23e"/><path d="M32 4 V11" /><circle cx="32" cy="5" r="3" fill="#ff3a2a"/>'),
  oil: S('<ellipse cx="32" cy="54" rx="24" ry="6" fill="#3a3d52"/><path d="M32 5 C32 5 14 27 14 39 A18 18 0 0 0 50 39 C50 27 32 5 32 5Z" fill="#20222e"/><ellipse cx="25" cy="38" rx="4" ry="7" fill="#7f8bb0" stroke="none"/>'),
  shock: S('<circle cx="32" cy="32" r="25" fill="none" stroke="#7fd6ff" stroke-width="7"/><circle cx="32" cy="32" r="25" fill="none" stroke-width="2"/><circle cx="32" cy="32" r="15" fill="none" stroke="#bfeaff" stroke-width="6"/><circle cx="32" cy="32" r="15" fill="none" stroke-width="2"/><circle cx="32" cy="32" r="6" fill="#ffffff"/>'),
  armor: S('<path d="M32 5 L53 13 V30 C53 45 43 54 32 59 C21 54 11 45 11 30 V13 Z" fill="#c9d3e6"/><path d="M32 14 L45 19 V31 C45 41 39 47 32 50 C25 47 19 41 19 31 V19 Z" fill="#ffc43a" stroke-width="3"/>'),
  repair: S('<g transform="rotate(-45 32 32)"><rect x="27" y="24" width="10" height="34" rx="4" fill="#c9d3e6"/><path d="M19 9 a14 14 0 1 0 26 0 v11 h-8 v-12 h-10 v12 h-8z" fill="#c9d3e6"/></g><circle cx="47" cy="47" r="12" fill="#5cd04a"/><path d="M47 41 V53 M41 47 H53" stroke="#fff" stroke-width="4"/>'),
};

export const UI_ICONS = {
  flag: S('<path d="M14 58 V8" stroke-width="5"/><path d="M14 9 H52 V35 H14 Z" fill="#fff"/><path d="M14 9 H23.5 V17.7 H14Z M33 9 H42.5 V17.7 H33Z M23.5 17.7 H33 V26.3 H23.5Z M42.5 17.7 H52 V26.3 H42.5Z M14 26.3 H23.5 V35 H14Z M33 26.3 H42.5 V35 H33Z" fill="#23264a" stroke="none"/>'),
  party: S('<path d="M8 56 L22 18 L46 42 Z" fill="#ffc43a"/><path d="M15 38 L30 26 M12 47 L38 34" stroke="#e8483a" stroke-width="4"/><circle cx="42" cy="12" r="4" fill="#3fb7ff"/><circle cx="54" cy="24" r="4" fill="#ff5fa2"/><path d="M34 8 L36 14 M50 34 L56 36 M46 4 L44 8" stroke-width="3"/>'),
  key: S('<circle cx="21" cy="43" r="13" fill="#ff9a3a"/><circle cx="21" cy="43" r="4" fill="#fff8ec"/><path d="M30 34 L54 10 M44 20 L50 26 M50 14 L56 20" stroke="#ff9a3a" stroke-width="7"/><path d="M30 34 L54 10 M44 20 L50 26 M50 14 L56 20" stroke-width="2"/>'),
  garage: S('<path d="M6 28 L32 8 L58 28 V56 H6 Z" fill="#ffc43a"/><rect x="15" y="31" width="34" height="25" fill="#e9ecf8"/><path d="M15 38 H49 M15 45 H49" stroke-width="3"/>'),
  lab: S('<path d="M24 6 H40 M27 6 V24 L12 52 C10 56 13 59 17 59 H47 C51 59 54 56 52 52 L37 24 V6" fill="#bfeaff"/><path d="M17 44 H47 L52 52 C54 56 51 59 47 59 H17 C13 59 10 56 12 52 Z" fill="#b08cff"/>'),
  gear: S('<path d="M28 4 H36 L38 12 L45 15 L52 10 L57 15 L52 22 L55 29 L62 30 V36 L55 38 L52 45 L56 52 L51 57 L44 52 L37 55 L36 62 H28 L26 55 L19 52 L12 57 L7 52 L12 45 L9 38 L2 36 V30 L9 28 L12 21 L7 14 L12 9 L19 14 L26 11 Z" fill="#fff"/><circle cx="32" cy="33" r="9" fill="#23264a"/>'),
  sound: S('<path d="M8 24 H20 L34 10 V54 L20 40 H8 Z" fill="#fff"/><path d="M42 22 C47 27 47 37 42 42 M49 15 C58 24 58 40 49 49" fill="none" stroke="#fff" stroke-width="5"/>'),
  mute: S('<path d="M8 24 H20 L34 10 V54 L20 40 H8 Z" fill="#fff"/><path d="M42 24 L56 40 M56 24 L42 40" stroke="#ff6a5a" stroke-width="6"/>'),
  full: S('<path d="M8 22 V8 H22 M42 8 H56 V22 M56 42 V56 H42 M22 56 H8 V42" fill="none" stroke="#fff" stroke-width="6"/>'),
  help: S('<circle cx="32" cy="32" r="26" fill="#fff"/><path d="M24 25 C24 14 40 14 40 24 C40 31 32 31 32 38" fill="none" stroke-width="6"/><circle cx="32" cy="48" r="3" fill="#23264a"/>'),
  back: S('<path d="M40 10 L18 32 L40 54" fill="none" stroke-width="9"/>'),
  left: S('<path d="M40 10 L18 32 L40 54" fill="none" stroke-width="9"/>'),
  right: S('<path d="M24 10 L46 32 L24 54" fill="none" stroke-width="9"/>'),
  plus: S('<path d="M32 12 V52 M12 32 H52" stroke="#a9b1cf" stroke-width="10"/>'),
  crown: S('<path d="M8 50 L12 18 L24 32 L32 12 L40 32 L52 18 L56 50 Z" fill="#ffc43a"/>'),
  robot: S('<rect x="12" y="20" width="40" height="32" rx="9" fill="#c9d3e6"/><circle cx="25" cy="35" r="5" fill="#3fb7ff"/><circle cx="39" cy="35" r="5" fill="#3fb7ff"/><path d="M32 20 V10" /><circle cx="32" cy="9" r="4" fill="#ff5fa2"/><path d="M24 45 H40" />'),
  copy: S('<rect x="20" y="20" width="32" height="36" rx="5" fill="#fff"/><path d="M14 44 H12 C10 44 9 43 9 41 V12 C9 10 10 8 12 8 H38 C40 8 41 9 41 11 V13" fill="none"/>'),
  car: S('<path d="M6 40 V31 C6 28 8 27 11 26 L19 24 L27 14 H43 L51 24 C56 25 58 27 58 31 V40 Z" fill="currentColor"/><path d="M29 18 H41 L46 24 H24 Z" fill="#bfeaff"/><circle cx="18" cy="42" r="8" fill="#2c2f3b"/><circle cx="46" cy="42" r="8" fill="#2c2f3b"/><circle cx="18" cy="42" r="3" fill="#c9d3e6" stroke-width="2"/><circle cx="46" cy="42" r="3" fill="#c9d3e6" stroke-width="2"/>'),
  play: S('<path d="M20 10 L52 32 L20 54 Z" fill="#fff"/>'),
  pause: S('<rect x="14" y="10" width="13" height="44" rx="3" fill="#fff"/><rect x="37" y="10" width="13" height="44" rx="3" fill="#fff"/>'),
  trophy: S('<path d="M18 8 H46 V22 C46 32 40 38 32 38 C24 38 18 32 18 22 Z" fill="#ffc43a"/><path d="M18 13 H8 C8 24 12 28 19 28 M46 13 H56 C56 24 52 28 45 28" fill="none"/><path d="M32 38 V48 M20 56 H44 V50 H20 Z" fill="#ffc43a"/>'),
  people: S('<circle cx="22" cy="22" r="10" fill="#ffd9b8"/><circle cx="44" cy="24" r="9" fill="#ffd9b8"/><path d="M6 54 C6 40 14 34 22 34 C30 34 38 40 38 54 Z" fill="#ff5fa2"/><path d="M34 54 C34 42 40 37 46 37 C53 37 58 42 58 54 Z" fill="#3fb7ff"/>'),
};
