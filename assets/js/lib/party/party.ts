import {NetworkSession} from "./comms";
import {fixedTimestamp} from "../util/ntp";
import {EventEmitter} from "events";

// sequence:
// 1) everyone joins
// 2) playlist constructed
// 3) everyone hits 'ready'
// 4) master broadcasts song selection
// 5) wait for everyone to reach ready state, announcing when done
// 6) master announces start time
// 7) game starts
// 8) song completes; return to 3

export interface PartyMember {
    nick: string;
    colour: string;
    data: boolean;
    ping: number;
    ready: boolean;
    me: boolean;
    loaded: boolean;
    score: number;
    part: number;
}

interface PartyMap {
    [key: string]: PartyMember;
}

export class Party extends EventEmitter {
    nick: string;
    party: PartyMap;
    sessionParty: PartyMap;
    queue: number[];
    playing: boolean;
    network: NetworkSession;

    constructor(nick: string) {
        super();
        this.nick = nick;
        this.party = {};
        this.queue = [];
        this.sessionParty = null;
        this.playing = false;
        this.network = new NetworkSession(this.nick);
        this.network.on('gotMemberList', (members) => this._handleMemberList(members));
        this.network.on('newMember', (member) => this._handleNewMember(member));
        this.network.on('memberLeft', (member) => this._handleMemberLeft(member));
        this.network.on('readyToGo', (message, peer) => this._handleReady(peer, message.part));
        this.network.on('dataChannelEstablished', (peer) => this._handleDataReady(peer));
        this.network.on('startGame', (message) => this._handleStartGame(message.time));
        this.network.on('loadTrack', (message) => this._handleLoadTrack(message.track));
        this.network.on('trackLoaded', (message, peer) => this._handleTrackLoaded(peer));
        this.network.on('updatedPlaylist', (songs) => this._handleUpdatedPlaylist(songs));
        this.network.on('sangNotes', (message, peer) => this._updateScore(peer, message.score));
    }

    on(event: 'startGame', listener: (delay: number) => any): this;
    on(event: 'partyUpdated', listener: () => any): this;
    on(event: 'loadTrack', listener: (track: number) => any): this;
    on(event: 'updatedPlaylist', listener: (songs: number[]) => any): this;
    on(event: string, listener: (...args: any[]) => any): this {
        return super.on(event, listener);
    }

    _makeMember(nick: string, colour: string): PartyMember {
        return {
            nick: nick,
            colour: colour,
            data: false,
            ping: null,
            ready: false,
            me: false,
            loaded: false,
            score: null,
            part: 0,
        }
    }

    _updateScore(peer: string, score: number): void {
        this.party[peer].score = score;
    }

    _handleMemberList(members: {[key: string]: {nick: string, colour: string}}): void {
        this.party = {};
        for (let [channel, {nick, colour}] of Object.entries(members)) {
            this.party[channel] = this._makeMember(nick, colour);
            if (this.network.channelName === channel) {
                this.party[channel].me = true;
            }
        }
        this.emit('partyUpdated');
    }

    _handleNewMember(member: {nick: string, colour: string, channel: string}): void {
        this.party[member.channel] = this._makeMember(member.nick, member.colour);
        if (this.network.channelName === member.channel) {
            this.party[member.channel].me = true;
        }
        this.emit('partyUpdated');
    }

    _handleMemberLeft(member: {nick: string, channel: string}) {
        delete this.party[member.channel];
        if (this.sessionParty) {
            delete this.sessionParty[member.channel];
            if (this.playing) {
                this._handleTrackLoaded();
            }
        }
        this.emit('partyUpdated');
    }

    async _handleDataReady(peer: string): Promise<void> {
        this.party[peer].data = true;
        this.emit('partyUpdated');
        this.party[peer].ping = await this.network.rtcConnection(peer).testLatency(5000);
        this.emit('partyUpdated');
    }

    _handleReady(peer: string, part: number): void {
        this.party[peer].ready = true;
        this.party[peer].part = part;
        this.emit('partyUpdated');
        if (this.playing) {
            console.warn("Got ready message but already playing.");
            return;
        }
        let pending = Object.values(this.party).reduce((a, v) => a + (v.ready ? 0 : 1), 0);
        if (pending === 0) {
            if (this.isMaster) {
                console.log("Time to begin!");
                this._broadcastTrack();
            } else {
                console.log("Waiting for the master to start...");
            }
        } else {
            console.log(`${pending} left to confirm...`);
        }
    }

    _handleTrackLoaded(peer?: string): void {
        if (peer) {
            this.sessionParty[peer].loaded = true;
            this.emit('partyUpdated');
        }
        console.log('session members', this.sessionParty);
        let pending = <number>Object.values(this.sessionParty).reduce((a, v) => a + (v.loaded ? 0 : 1), 0);
        if (pending === 0) {
            if (this.isMaster) {
                console.log("Time to begin!");
                this._startGame();
            } else {
                console.log("Waiting for the master to start...");
            }
        } else {
            console.log(`${pending} left to finish downloading...`);
        }
    }

    _broadcastTrack(): void {
        let song = this.queue[0];
        if (!song) {
            song = (Math.random() * 900)|0;
        }
        this.network.broadcast({action: "loadTrack", track: song});
        this.network.sendToServer({action: "removeFromQueue", song: song});
        this._handleLoadTrack(song);
    }

    _handleLoadTrack(track: number): void {
        if (this.playing) {
            console.warn("Got load track command when already playing.");
            return;
        }
        this.playing = true;
        for (let member of Object.values(this.party)) {
            member.loaded = false;
        }
        this.sessionParty = {...this.party};
        console.log('session members', this.sessionParty);
        this.emit("partyUpdated");
        this.emit("loadTrack", track);
    }

    trackDidLoad(): void {
        this.network.broadcast({action: "trackLoaded"});
        this._handleTrackLoaded(this.network.channelName);
    }

    _startGame(): void {
        let maxPing = Object.values(this.sessionParty).reduce((a, v) => a + (v.ping||0), 0) / 2;
        let startTime = Math.round(fixedTimestamp() + maxPing * 1.5);
        startTime += 50; // because if it's very short other issues can appear.
        this._handleStartGame(startTime);
        this.network.broadcast({action: "startGame", time: startTime});
    }

    _handleStartGame(time: number): void {
        let now = fixedTimestamp();
        let delay = time - now;
        setTimeout(() => this.emit("startGame"), delay);
        console.log(`Game start in ${delay}ms.`);
        for (let member of Object.values(this.sessionParty)) {
            member.loaded = false;
            member.ready = false;
        }
    }

    _handleUpdatedPlaylist(songs: number[]): void {
        this.queue = songs;
        this.emit('updatedPlaylist', songs);
    }

    setReady(part: number): void {
        this.network.broadcast({action: "readyToGo", part});
        this._handleReady(this.network.channelName, part);
    }

    trackEnded(): void {
        this.playing = false;
        this.sessionParty = null;
        this.emit('partyUpdated');
    }

    addToPlaylist(id: number): void {
        this.network.sendToServer({action: "addToQueue", song: id});
    }

    get isMaster(): boolean {
        let peers = Object.keys(this.sessionParty || this.party);
        peers.sort();
        return (this.network.channelName === peers[0]);
    }

    get me(): PartyMember {
        return this.party[this.network.channelName];
    }

    get memberIndex(): number {
        let peers = Object.values(this.sessionParty || this.party);
        peers.sort();
        return peers.findIndex((x) => x.me);
    }
}