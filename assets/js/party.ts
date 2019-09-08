import {NickPrompt} from "./lib/party/nick"
import {syncTime} from "./lib/util/ntp";
import {GameController} from "./lib/controller";
import {isCompatible} from "./lib/compat";

import "../css/party.css";

if (!isCompatible()) {
    document.getElementById('unsupported-browser').style.display = 'block';
} else {
    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('nick-confirm-button').removeAttribute('disabled');

        let nickPrompt = new NickPrompt();
        let controller = null;
        nickPrompt.prompt().then((nick) => {
            controller = new GameController(nick,
                document.getElementById('game-container'),
                document.getElementById('party-container'));
        });
        setTimeout(syncTime, 1000);
    });
}
