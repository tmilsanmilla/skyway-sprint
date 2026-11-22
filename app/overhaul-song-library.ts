/** Official artist/label players only. No audio is copied or rehosted.
 * Clip completion uses the player's actual playback, never a wall-time guess.
 * Provenance: outputs/skyway-six-class-overhaul-20261121/song-oembed-*.json. */
export const SONG_LANGUAGES = ["French","Spanish","Japanese","Mandarin Chinese","German","Russian","Italian","Portuguese"] as const;
export type SongLanguage = typeof SONG_LANGUAGES[number];
export type MusicClip = {videoId:string;start:number;seconds:number};
export type SongClip = MusicClip & {language:SongLanguage};
export const SONG_CLIPS: readonly SongClip[] = [
  {
    "language": "French",
    "videoId": "VHoT4N43jK8",
    "start": 45,
    "seconds": 30
  },
  {
    "language": "French",
    "videoId": "oiKj0Z_Xnjc",
    "start": 60,
    "seconds": 35
  },
  {
    "language": "French",
    "videoId": "K5KAc5CoCuk",
    "start": 75,
    "seconds": 40
  },
  {
    "language": "French",
    "videoId": "S_xH7noaqTA",
    "start": 45,
    "seconds": 45
  },
  {
    "language": "French",
    "videoId": "P3QS83ubhHE",
    "start": 60,
    "seconds": 30
  },
  {
    "language": "French",
    "videoId": "UKftOH54iNU",
    "start": 75,
    "seconds": 35
  },
  {
    "language": "Spanish",
    "videoId": "kJQP7kiw5Fk",
    "start": 45,
    "seconds": 30
  },
  {
    "language": "Spanish",
    "videoId": "NUsoVlDFqZg",
    "start": 60,
    "seconds": 35
  },
  {
    "language": "Spanish",
    "videoId": "YXnjy5YlDwk",
    "start": 75,
    "seconds": 40
  },
  {
    "language": "Spanish",
    "videoId": "Dsp_8Lm1eSk",
    "start": 45,
    "seconds": 45
  },
  {
    "language": "Spanish",
    "videoId": "y8rBC6GCUjg",
    "start": 60,
    "seconds": 30
  },
  {
    "language": "Spanish",
    "videoId": "Rht7rBHuXW8",
    "start": 75,
    "seconds": 35
  },
  {
    "language": "Japanese",
    "videoId": "x8VYWazR5mE",
    "start": 45,
    "seconds": 30
  },
  {
    "language": "Japanese",
    "videoId": "SX_ViT4Ra7k",
    "start": 60,
    "seconds": 35
  },
  {
    "language": "Japanese",
    "videoId": "ZRtdQ81jPUQ",
    "start": 75,
    "seconds": 40
  },
  {
    "language": "Japanese",
    "videoId": "-tKVN2mAKRI",
    "start": 45,
    "seconds": 45
  },
  {
    "language": "Japanese",
    "videoId": "TQ8WlA2GXbk",
    "start": 60,
    "seconds": 30
  },
  {
    "language": "Japanese",
    "videoId": "CwkzK-F0Y00",
    "start": 75,
    "seconds": 35
  },
  {
    "language": "Mandarin Chinese",
    "videoId": "Z8Mqw0b9ADs",
    "start": 45,
    "seconds": 30
  },
  {
    "language": "Mandarin Chinese",
    "videoId": "bu7nU9Mhpyo",
    "start": 60,
    "seconds": 35
  },
  {
    "language": "Mandarin Chinese",
    "videoId": "T4SimnaiktU",
    "start": 75,
    "seconds": 40
  },
  {
    "language": "Mandarin Chinese",
    "videoId": "w0dMz8RBG7g",
    "start": 45,
    "seconds": 45
  },
  {
    "language": "Mandarin Chinese",
    "videoId": "DYptgVvkVLQ",
    "start": 60,
    "seconds": 30
  },
  {
    "language": "Mandarin Chinese",
    "videoId": "Y4xCVlyCvX4",
    "start": 75,
    "seconds": 35
  },
  {
    "language": "German",
    "videoId": "W3q8Od5qJio",
    "start": 45,
    "seconds": 30
  },
  {
    "language": "German",
    "videoId": "StZcUAPRRac",
    "start": 60,
    "seconds": 35
  },
  {
    "language": "German",
    "videoId": "EOnSh3QlpbQ",
    "start": 75,
    "seconds": 40
  },
  {
    "language": "German",
    "videoId": "x2rQzv8OWEY",
    "start": 45,
    "seconds": 45
  },
  {
    "language": "German",
    "videoId": "Fpu5a0Bl8eY",
    "start": 60,
    "seconds": 30
  },
  {
    "language": "German",
    "videoId": "haECT-SerHk",
    "start": 75,
    "seconds": 35
  },
  {
    "language": "Russian",
    "videoId": "nj5nuYYrZvg",
    "start": 45,
    "seconds": 30
  },
  {
    "language": "Russian",
    "videoId": "V7iCZQgK0SQ",
    "start": 60,
    "seconds": 35
  },
  {
    "language": "Russian",
    "videoId": "eaI7RD-y7EE",
    "start": 75,
    "seconds": 40
  },
  {
    "language": "Russian",
    "videoId": "nlb4CrfvXTc",
    "start": 45,
    "seconds": 45
  },
  {
    "language": "Russian",
    "videoId": "fuPX8mjeb-E",
    "start": 60,
    "seconds": 30
  },
  {
    "language": "Russian",
    "videoId": "G8zVtSri7MM",
    "start": 75,
    "seconds": 35
  },
  {
    "language": "Italian",
    "videoId": "QN1odfjtMoo",
    "start": 45,
    "seconds": 30
  },
  {
    "language": "Italian",
    "videoId": "FpOEN93LX-E",
    "start": 60,
    "seconds": 35
  },
  {
    "language": "Italian",
    "videoId": "unRjK82bDLw",
    "start": 75,
    "seconds": 40
  },
  {
    "language": "Italian",
    "videoId": "ZZjnfWx0cvw",
    "start": 45,
    "seconds": 45
  },
  {
    "language": "Italian",
    "videoId": "iywXK9Dj2o4",
    "start": 60,
    "seconds": 30
  },
  {
    "language": "Italian",
    "videoId": "QTIkudYT3mg",
    "start": 75,
    "seconds": 35
  },
  {
    "language": "Portuguese",
    "videoId": "hcm55lU9knw",
    "start": 45,
    "seconds": 30
  },
  {
    "language": "Portuguese",
    "videoId": "Z1ZKaR-9Kt4",
    "start": 60,
    "seconds": 35
  },
  {
    "language": "Portuguese",
    "videoId": "eCyMh-mZ1B0",
    "start": 75,
    "seconds": 40
  },
  {
    "language": "Portuguese",
    "videoId": "zwqrmEMB0wc",
    "start": 45,
    "seconds": 45
  },
  {
    "language": "Portuguese",
    "videoId": "t7M89YJAPhM",
    "start": 60,
    "seconds": 30
  },
  {
    "language": "Portuguese",
    "videoId": "tI55Zu9uZEM",
    "start": 75,
    "seconds": 35
  }
];
export const PHOENIX_CLIP: MusicClip={videoId:"r2QyLA5w3ps",start:54,seconds:30};
export function songRound(seed:string,wave:number){
 let hash=2166136261;for(const c of `${seed}:${wave}`){hash^=c.charCodeAt(0);hash=Math.imul(hash,16777619)>>>0;}
 return hash%SONG_CLIPS.length;
}
