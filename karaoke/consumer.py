import json

from channels import Channel, Group
from channels.security.websockets import allowed_hosts_only
from channels.sessions import channel_and_http_session

from .models import Party, PartyMember, Playlist, Song


@allowed_hosts_only
@channel_and_http_session
def party_connected(message, party_id):
    if party_id != message.http_session['party_id']:
        raise Exception(f"Party ID mismatch: {party_id} != {message.channel_session['party_id']}")
    old_member_id = message.http_session.get('member_id')
    if old_member_id:
        try:
            member = PartyMember.objects.get(id=old_member_id)
        except:
            pass
        else:
            if member.nick:
                group = Group(f"party-{member.party.id}")
                group.send({"text": json.dumps({
                    "action": "member_left",
                    "channel": member.channel,
                    "nick": member.nick
                })})
                group.discard(message.reply_channel)
            member.delete()
        message.http_session.delete('member_id')
    party = Party.objects.get(id=party_id)
    if party.members.count() >= 6:
        print("Too many members!")
        message.reply_channel.send({"text": json.dumps({"action": "goodbye", "message": "room_full"})})
        message.reply_channel.send({"close": True})
        return
    member = PartyMember(party=party, channel=message.reply_channel.name)
    member.save()
    message.http_session['member_id'] = member.id
    message.http_session.save()
    message.reply_channel.send({"accept": True})
    message.reply_channel.send({"text": json.dumps({"action": "hello", "channel": message.reply_channel.name})})


def get_playlist(party):
    print([x.song.id for x in Playlist.objects.filter(party=party).order_by('id')])
    return [x.song.id for x in Playlist.objects.filter(party=party).order_by('id')]


@channel_and_http_session
def party_message(message):
    content = json.loads(message.content['text'])
    action = content['action']

    if action == 'hello':
        party = Party.objects.get(id=message.http_session['party_id'])
        member = PartyMember.objects.get(id=message.http_session['member_id'])
        member.nick = content['nick']

        group = Group(f"party-{party.id}")

        all_colours = ['#058fbe', '#d70000', '#00b100', '#a300c4', '#ee7600', '#122b53']
        used_colours = set(x.colour for x in party.members.all())
        for colour in all_colours:
            if colour not in used_colours:
                member.colour = colour
                break
        member.save()

        message.http_session['nickname'] = content['nick']
        message.reply_channel.send({"text": json.dumps({
            "action": "member_list",
            "members": {x.channel: {'nick': x.nick, 'colour': x.colour, 'id': x.id} for x in party.members.all()},
        })})
        message.reply_channel.send({"text": json.dumps({
            "action": "playlist",
            "playlist": get_playlist(party)
        })})
        group.add(message.reply_channel)
        group.send({"text": json.dumps({
            "action": "new_member",
            "channel": message.reply_channel.name,
            "nick": member.nick,
            "colour": member.colour,
            "id": member.id,
        })})
        message.http_session.save()
    elif action == 'relay':
        Channel(content['target']).send({"text": json.dumps({
            "action": "relay",
            "origin": message.reply_channel.name,
            "message": content['message'],
        })})
    elif action == 'addToQueue':
        party = Party.objects.get(id=message.http_session['party_id'])
        song = Song.objects.get(id=content['song'])
        if Playlist.objects.filter(party=party, song=song).exists():
            # Silently do nothing if this would be a duplicate.
            return
        entry = Playlist(party=party, song=song, order=1)
        entry.save()
        Group(f"party-{party.id}").send({"text": json.dumps({
            "action": "playlist",
            "playlist": get_playlist(party)
        })})
    elif action == 'removeFromQueue':
        party = Party.objects.get(id=message.http_session['party_id'])
        song = Song.objects.get(id=content['song'])
        Playlist.objects.filter(party=party, song=song).delete()
        Group(f"party-{party.id}").send({"text": json.dumps({
            "action": "playlist",
            "playlist": get_playlist(party)
        })})


@channel_and_http_session
def party_disconnected(message):
    if 'member_id' not in message.http_session:
        return
    try:
        PartyMember.objects.get(id=message.http_session['member_id']).delete()
    except PartyMember.DoesNotExist:
        print("No such party member.")
    message.http_session.delete('member_id')
    message.http_session.save()
    if 'nickname' not in message.http_session:
        return
    group = Group(f"party-{message.http_session['party_id']}")
    group.discard(message.reply_channel)
    group.send({"text": json.dumps({
        "action": "member_left",
        "channel": message.reply_channel.name,
        "nick": message.http_session['nickname']
    })})
