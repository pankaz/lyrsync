import bezier from 'bezier-easing';

let initialised = false;
const ytReady = new Promise((resolve) => {
    window['onYouTubeIframeAPIReady'] = () => { resolve(); };
})

const lerp = (x: number, min: number, max: number) => min*(1-x)+max*x;
const unlerp = (x: number, min: number, max: number) => (x-min) / (max-min);
const clamp = (x: number, min?: number, max?: number) => Math.min(Math.max(x, min || 0), max || 1);

let lyricsAst: AST;
let renderedLyrics: Array<RenderedCard>;
function init() {
    const youtubePromise = initialiseYoutubePlayer();

    const lyricsFile = (document.querySelector<HTMLAnchorElement>("link.lyricsFile")).href;

    fetch(lyricsFile).then(response => {
        if(!response.ok) {
            console.error("Failed to load lyrics", response);
        }

        response.text().then(responseText => {
            lyricsAst = parseLyrics(responseText);
            renderedLyrics = renderLyrics();
            console.log(renderedLyrics);
            layoutLyrics();
            youtubePromise.then(player => {
                initialised = true;
                const start = document.querySelector<HTMLDivElement>(".start");
                start.style.display = "block";
                start.addEventListener("click", () => {
                    start.style.display = "none";
                    player.playVideo();
                    document.querySelector<HTMLDivElement>(".container").style.opacity = '1';
                })
            });
        }, err => {
            console.error("Failed to retrieve lyrics", err);
        });
    });
}
init();

window.addEventListener("resize", () => {
    if(initialised) {
        layoutLyrics();
    }
});


let currentTime = 0;
let playbackSpeed = 0;
let playing = false;
function initialiseYoutubePlayer() {
    return new Promise<YT.Player>((resolve) => {
        ytReady.then(() => {
            const youtubePlayer = document.querySelector<HTMLDivElement>(".youtubeContainer .player");
            const youtubeId = youtubePlayer.dataset.youtubeId;
            const player = new YT.Player(youtubePlayer, {
                height: '100%',
                width: '100%',
                videoId: youtubeId,
                playerVars: {
                    modestbranding: 1
                },
                events: {
                    'onReady': () => {
                        window.setInterval(() => {
                            playbackSpeed = player.getPlaybackRate();
                            currentTime = player.getCurrentTime();
                            playing = player.getPlayerState() == 1;
                        }, 1000);
                        resolve(player);
                    },
                    'onStateChange': state => {
                        playbackSpeed = player.getPlaybackRate();
                        currentTime = player.getCurrentTime();
                        playing = player.getPlayerState() == 1;
                        if(state.data == 0) {
                            player.seekTo(0, true);
                            player.playVideo();
                        }
                    }
                }
            });
        });
    });
}

interface AST {
    cards: Array<ASTCard>;
}
interface ASTCard {
    timecode: number;
    voices: {[voice: string]: Array<ASTWord>};
}
interface ASTWord {
    timecode: number;
    contents: string;
}
const timecodeRegex = /^(\d{2})\:(\d{2})\.(\d{2})$/;
const tagRegex = /^([a-z]+)\:(.*)$/;
function parseLyrics(lyricsFile): AST {
    const cards: Array<ASTCard> = [];

    let isEscaped = false;
    let currentCard = {
        timecode: null,
        voices: {}
    };
    let currentWord = {
        timecode: null,
        contents: ""
    };
    let currentVoice = null;
    for(let i = 0; i < lyricsFile.length; i++) {
        const char = lyricsFile[i];
        if(isEscaped) {
            currentWord.contents += char;
            isEscaped = false;
            continue;
        }

        switch(char) {
            case "\n":
                break;
            case "\\":
                isEscaped = true;
                break;
            case "[":
            case "<":
                const isCardTag = char === "[";
                const tagEnd = lyricsFile.indexOf(isCardTag ? "]" : ">", i + 1);
                if(tagEnd === -1) {
                    throw new Error("Lyrics parsing error: Expected ], reached EOF");
                }
                const tagContents = lyricsFile.slice(i + 1, tagEnd);
                i = tagEnd;

                const timecodeMatches = tagContents.match(timecodeRegex);
                if(timecodeMatches) {
                    const timecode = parseInt(timecodeMatches[1], 10) * 60 + parseInt(timecodeMatches[2], 10) + parseInt(timecodeMatches[3], 10) / 100;
                    // Start new word
                    if(currentWord.timecode !== null && currentWord.contents) {
                        if(!currentCard.voices[currentVoice]) {
                            currentCard.voices[currentVoice] = [];
                        }
                        currentCard.voices[currentVoice].push(currentWord);
                    }
                    currentWord = {
                        timecode,
                        contents: ""
                    };
                    if(isCardTag) {
                        // Start new card
                        if(currentCard.timecode !== null) {
                            cards.push(currentCard);
                        }
                        currentCard = {
                            timecode,
                            voices: []
                        };
                    }
                } else {
                    const tagMatches = tagContents.match(tagRegex);
                    const [, tagType, tagValue] = tagMatches;

                    if(isCardTag) {
                        switch(tagType) {
                            case "voice":
                                // Start new word and change voice
                                if(currentWord.timecode !== null && currentWord.contents) {
                                    currentCard.voices[currentVoice].push(currentWord);
                                }
                                currentWord = {
                                    timecode: null,
                                    contents: ""
                                };
                                currentVoice = tagValue;
                                if(!currentCard.voices[currentVoice]) {
                                    currentCard.voices[currentVoice] = [];
                                }
                                break;
                            default:
                                // Unrecognised tag
                                break;
                        }
                    }
                }
                
                break;
            default:
                currentWord.contents += char;
                break;
        }
    }

    if(currentCard.timecode !== null) {
        cards.push(currentCard);
    }

    cards.forEach(card => {
        for(let voice in card.voices) {
            card.voices[voice].sort((a, b) => a.timecode - b.timecode);
        }
    });
    cards.sort((a, b) => a.timecode - b.timecode);

    return {
        cards
    };
}

interface RenderedCard {
    cardAst: ASTCard,
    cardElm: HTMLDivElement,
    contentsElm: HTMLDivElement,
    voices: Array<RenderedVoice>,
    cardTimers: Array<Timer>
}
interface RenderedVoice {
    name: string,
    voiceElm: HTMLDivElement,
    contentsElm: HTMLDivElement,
    words: Array<RenderedWord>
}
interface RenderedWord {
    wordAst: ASTWord,
    wordElm: HTMLSpanElement,
    wordTimers: Array<Timer>
}
const container = document.querySelector<HTMLDivElement>(".lyricsContainer");
function renderLyrics() {
    return lyricsAst.cards.map<RenderedCard>(cardAst => {
        const cardElm = document.createElement("div");
        cardElm.classList.add("card");
        cardElm.style.setProperty("--card-start-time", "" + cardAst.timecode * 1000);

        const contentsElm = document.createElement("div");
        contentsElm.classList.add("contents");

        cardElm.appendChild(contentsElm);
        container.appendChild(cardElm);

        const voices: Array<RenderedVoice> = [];
        for(let voice in cardAst.voices) {
            const voiceElm = document.createElement("div");
            voiceElm.classList.add("voice");
            voiceElm.classList.add(voice);

            contentsElm.appendChild(voiceElm);

            const voiceContentsElm = document.createElement("div");
            voiceContentsElm.classList.add("voiceContents");
            voiceElm.appendChild(voiceContentsElm);

            const words = cardAst.voices[voice].map<RenderedWord>(wordAst => {
                const wordElm = document.createElement("span");
                wordElm.classList.add("word");
                wordElm.innerHTML = wordAst.contents
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;")
                    .replace(/"/g, "&quot;")
                    .replace(/'/g, "&#039;")
                    .replace(/ /g, "&nbsp;")
                    .replace(/\n/g, "<br />");
                voiceContentsElm.appendChild(wordElm);

                const wordTimers = parseTimers(getComputedStyle(wordElm).getPropertyValue("--word-timers"));

                return {
                    wordAst,
                    wordElm,
                    wordTimers
                };
            });

            voices.push({
                name: voice,
                voiceElm,
                contentsElm: voiceContentsElm,
                words
            });
        }

        const cardTimers = parseTimers(getComputedStyle(cardElm).getPropertyValue("--card-timers"));

        return {
            cardAst,
            cardElm,
            contentsElm,
            voices,
            cardTimers
        };
    });
}

const oscillateFunctionGenerator = (numberOfOscillations) => (magnitude, t) => Math.sin(t * Math.PI * 2 / numberOfOscillations);

const timingFunctions: {[name: string]: (x: number) => number} = {
    instant: x => x > 0 ? 1 : 0,
    linear: x => x,
    ease: bezier(0.25, 0.1, 0.25, 1),
    easeIn: bezier(0.42, 0, 1, 1),
    easeOut: bezier(0, 0, 0.58, 1),
    easeInOut: bezier(0.42, 0, 0.58, 1)
};
const postprocessingFunctions: {[name: string]: (timedProgress: number, linearProgress: number) => number} = {
    none: x => x,
    oscillate4: oscillateFunctionGenerator(4)
};
interface Timer {
    name: string,
    fromReference: string,
    fromOffset: number,
    toReference: string,
    toOffset: number,
    timingFunction: (x: number) => number,
    lastValue?: number
};
function parseTimers(timersString: string): Array<Timer> {
    return timersString.split(",").filter(s => s).map(timerString => {
        let [name, fromReference, fromOffset, toReference, toOffset, forwardTimingFunctionName, reverseTimingFunctionName, postprocessingFunctionName] = timerString.trim().split(" ");

        if(!forwardTimingFunctionName) {
            forwardTimingFunctionName = "linear";
        }
        if(!timingFunctions[forwardTimingFunctionName]) {
            throw new Error("Attempt to use non-existent timing function " + forwardTimingFunctionName);
        }

        if(reverseTimingFunctionName == "none") {
            reverseTimingFunctionName = null;
        }
        if(reverseTimingFunctionName && !timingFunctions[reverseTimingFunctionName]) {
            throw new Error("Attempt to use non-existent reverse timing function " + reverseTimingFunctionName);
        }

        if(!postprocessingFunctionName) {
            postprocessingFunctionName = "none";
        }
        if(!postprocessingFunctions[postprocessingFunctionName]) {
            throw new Error("Attempt to use non-existent postprocessing function " + postprocessingFunctionName);
        }

        const forwardTimingFunction = timingFunctions[forwardTimingFunctionName];
        const reverseTimingFunction = reverseTimingFunctionName ? timingFunctions[reverseTimingFunctionName] : null;
        const postprocessingFunction = postprocessingFunctions[postprocessingFunctionName];

        const timingFunction = (linearProgress) => {
            const timedProgress = reverseTimingFunction ?
                (
                    linearProgress < 0.5 ?
                    forwardTimingFunction(unlerp(linearProgress, 0, 0.5)) :
                    lerp(reverseTimingFunction(unlerp(linearProgress, 0.5, 1)), 1, 0)
                ) :
                forwardTimingFunction(linearProgress);
        
            const postprocessed = postprocessingFunction ? postprocessingFunction(timedProgress, linearProgress) : timedProgress;
        
            return postprocessed;
        }

        return {
            name,
            fromReference,
            fromOffset: parseFloat(fromOffset),
            toReference,
            toOffset: parseFloat(toOffset),
            timingFunction
        };
    });
}

function getTimerValue(timer: Timer, time: number, referenceValues: {[name: string]: number}): number {
    const from = referenceValues[timer.fromReference] + timer.fromOffset;
    const to = referenceValues[timer.toReference] + timer.toOffset;
    const linearProgress = clamp(unlerp(time, from, to));
    return timer.timingFunction(linearProgress);
}

function layoutLyrics() {
    let previousVoiceWidths = [];
    for(let card of renderedLyrics) {
        // It's important to ensure that all voices have the same height, otherwise the separator will move and it will look bad
        const voiceElms = card.voices.map(v => v.voiceElm);
        const voiceContentsElms = card.voices.map(v => v.contentsElm);
        voiceContentsElms.forEach(voiceElm => voiceElm.style.height = "auto");
        const voiceHeight = Math.max(...voiceContentsElms.map(voiceElm => voiceElm.getBoundingClientRect().height));
        voiceContentsElms.forEach(voiceElm => voiceElm.style.height = voiceHeight + "px");

        // Here's some extra data that's used for separator sizing (e.g. etoile et toi)
        const voiceWidths = voiceContentsElms.map(contentsElm => contentsElm.getBoundingClientRect().width);
        voiceElms.forEach((voiceElm, i) => {
            voiceElm.style.setProperty("--voice-width", "" + voiceWidths[i]);
            voiceElm.style.setProperty("--next-voice-width", "" + (voiceWidths[i + 1] || 0));
            voiceElm.style.setProperty("--previous-card-voice-width", "" + (previousVoiceWidths[i] || voiceWidths[i]));
            voiceElm.style.setProperty("--previous-card-next-voice-width", "" + (previousVoiceWidths[i + 1] || (voiceWidths[i + 1] || 0)));
        });
        previousVoiceWidths = voiceWidths;
    }
}

let lastDraw = null;
function redraw(now) {
    if(!initialised) {
        window.requestAnimationFrame(redraw);
        return;
    }

    if(lastDraw) {
        const delta = now - lastDraw;
        if(playing) {
            currentTime += delta * playbackSpeed / 1000;
        }
    }
    lastDraw = now;

    for(let cardIndex = 0; cardIndex < renderedLyrics.length; cardIndex++) {
        const card = renderedLyrics[cardIndex];
        const nextCard = renderedLyrics[cardIndex + 1];
        const cardEnd = (nextCard || card).cardAst.timecode;
        card.cardTimers.forEach(timer => {
            const value = getTimerValue(timer, currentTime, { start: card.cardAst.timecode, end: cardEnd });
            if(value != timer.lastValue) {
                card.cardElm.style.setProperty(timer.name, "" + value);
                timer.lastValue = value;
            }
        });

        for(let voice of card.voices) {
            for(let wordIndex = 0; wordIndex < voice.words.length; wordIndex++) {
                const word = voice.words[wordIndex];
                const nextWord = voice.words[wordIndex + 1];
                word.wordTimers.forEach(timer => {
                    const value = getTimerValue(timer, currentTime, { start: word.wordAst.timecode, end: nextWord ? nextWord.wordAst.timecode : cardEnd });
                    if(value != timer.lastValue) {
                        word.wordElm.style.setProperty(timer.name, "" + value);
                        timer.lastValue = value;
                    }
                });
            }
        }
    }

    window.requestAnimationFrame(redraw);
}
redraw(window.performance.now());