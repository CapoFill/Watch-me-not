const Discord = require('discord.js');
require('dotenv').config();
const mysql = require('mysql');
const { entersState, joinVoiceChannel, VoiceConnectionStatus, EndBehaviorType } = require('@discordjs/voice');
const { Client, Intents, GatewayIntentBits, channelMention, messageLink,  Collection, VoiceStatus, ContextMenuCommandBuilder } = require('discord.js');
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildPresences
    ], 
    partials: ['MESSAGE', 'CHANNEL', 'REACTION'],
});

var db_con = mysql.createConnection({
    host: "localhost",
    user: process.env.MYSQLUSER,
    password: process.env.MYSQLPASS,
    database: "discord_logs_db",
    charset: "UTF8_GENERAL_CI" 
    
});

db_con.connect(function(err) {
    if (err) throw err;
    console.log("Connected to MySQL DB!")
});

client.on('ready', async () => {
    // [...]
    console.log(`Logged in as ${client.user.tag}!`)
    var list = client.guilds.cache.get(process.env.GUILDID);
    await list.members.fetch();
    list.members.cache.forEach(member => {
        db_con.query('INSERT IGNORE INTO members VALUES (?, ?, ?, ?, ?, ?)', [member.id, member.user.bot, member.joinedTimestamp, member.displayName, member.nickname, member.pending]);
    });

   
    await list.members.guild.roles.fetch();
    list.members.guild.roles.cache.forEach(role => {
        role.members.forEach(member => {
             db_con.query('INSERT IGNORE INTO members_has_roles VALUES (?, ?)', [member.id, role.id]);
        })
    });

    await list.channels.fetch();
    list.channels.cache.forEach(channel => {
        db_con.query('INSERT IGNORE INTO channels VALUES (?, ?, ?, ?, ?, ?)', [channel.id, channel.name, channel.parentId, channel.createdTimestamp, channel.type, channel.url]);
        list.channels.guild.members.cache.forEach(member => {
            db_con.query('INSERT IGNORE INTO channel_has_members VALUES (?, ?)', [channel.id, member.id]);
        })       
    });
    
    await list.roles.fetch();
    list.roles.cache.forEach(role => {
        db_con.query('INSERT IGNORE INTO roles VALUES (?, ?, ?, ?, ?, ?, ?)', [role.id, role.name, role.hoist, role.createdTimestamp, role.mentionable, role.managed, role.permissions.bitfield]);
    })

    await list.emojis.fetch();
    let emoji_animated;
    list.emojis.cache.forEach(emoji => {
        if (emoji.animated === true) {
            emoji_animated = 1;
        } else {
            emoji_animated = 0;
        }
        db_con.query('INSERT IGNORE INTO reactions VALUES(?, ?, ?, ?, ?)', [emoji.id, emoji.name, emoji.identifier, emoji.createdTimestamp, emoji_animated]);
    })

});

client.on('guildMemberAdd', member => {
    db_con.query('INSERT IGNORE INTO members VALUES (?, ?, ?, ?, ?, ?)', [member.id, member.user.bot, member.joinedTimestamp, member.displayName, member.nickname, member.pending]);
})


client.on('messageCreate', async (message) => {
    let message_author = message.author.toString().substring(2, message.author.toString().length - 1);
    let message_references;
    if (message.type === 19) {
        message_references = message.reference.messageId;
    } else {
        message_references = 'NONE';
    }
    db_con.query('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)', 
    [message.id, message.content, message.createdTimestamp, message.applicationId, message.nonce, 
        message_author, message.channelId, message_references]);


    if (message.attachments) {
        let attachment_ephemeral;
        let attachment_spoiler;
        let attachment_author = message.author.toString().substring(2, message.author.toString().length - 1);
        message.attachments.forEach(attachment => {
            console.log(attachment);
            if (attachment.ephemeral) {
                attachment_ephemeral = 1;
            } else {
                attachment_ephemeral = 0;
            }

            if (attachment.spoiler) {
                attachment_spoiler = 1;
            } else {
                attachment_spoiler = 0;
            }
            db_con.query('INSERT INTO attachments VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [attachment.id, attachment.name, attachment.contentType, attachment.description, attachment_ephemeral, attachment.proxyURL, attachment.url, attachment_spoiler, message.id, attachment_author]);
        })
    }
})
client.on('messageUpdate', (oldMessage, newMessage) => {
    let edit_timestamp = Date.now();
    let message_author = oldMessage.author.toString().substring(2, oldMessage.author.toString().length - 1);
    db_con.query('INSERT INTO message_edits (edit_old_message, edit_new_message, edit_timestamp, messages_msg_id, members_mem_id) VALUES (?, ?, ?, ?, ?)', [oldMessage.content, newMessage.content, edit_timestamp, oldMessage.id, message_author]);
});

client.on('messageDelete', (message) => {
    let del_timestamp = Date.now();
    let message_author = message.author.toString().substring(2, message.author.toString().length - 1);
    db_con.query('INSERT INTO message_deleted (del_timestamp, messages_msg_id, members_mem_id) VALUES (?, ?, ?)', [del_timestamp, message.id, message_author]);
});


client.on('voiceStateUpdate', (oldVoiceState, newVoiceState) => { 
    let voice_connected = false;
    let voice_disconnected = false;
    let voice_moved = false;
    let voice_new_cha = null;
    let voice_old_cha = null; 
    let voice_update_timestamp = Date.now();
    if (newVoiceState.channel) { 
        voice_connected = true;
        console.log(`${newVoiceState.member.user.tag} connected to ${newVoiceState.channel.name}.`);
        voice_new_cha = newVoiceState.channel.id;
        if (newVoiceState.channel.members.size === 1) {
            console.log(`Add user client recorder to ${newVoiceState.channel.name}`);
            if (oldVoiceState.channel) {
                voice_old_cha = oldVoiceState.channel.id;
                voice_moved = true;
                voice_new_cha = newVoiceState.channel.id;
                if (oldVoiceState.channel.members.size === 0) {
                    console.log(`Channel ${oldVoiceState.channel.name} is empty`);
                } 
            }
        } else {
            if (oldVoiceState.channel) {
                console.log(`Channel ${newVoiceState.channel.name} has ${newVoiceState.channel.members.size} members, and channel ${oldVoiceState.channel.name} has ${oldVoiceState.channel.members.size} members`);
            } 
            if (oldVoiceState.channel.members.size === 0) {
                console.log(`Channel ${oldVoiceState.channel.name} is empty`);
            }
        };
        
    } else if (oldVoiceState.channel && !newVoiceState.channel) { 
        voice_disconnected = true;
        voice_old_cha = oldVoiceState.channel.id;
        console.log(`${oldVoiceState.member.user.tag} disconnected from ${oldVoiceState.channel.name}.`);

        if (oldVoiceState.channel.members.size === 0) {
            console.log(`Channel ${oldVoiceState.channel.name} is empty`);
        } else {
            console.log(`Channel ${oldVoiceState.channel.name} has ${oldVoiceState.channel.members.size} members`)
        }
    };
    
    let members_mem_id;
    if (newVoiceState.member.user.id) {
        members_mem_id = newVoiceState.member.user.id;
    } else {
        members_mem_id = oldVoiceState.member.user.id;
    }
    db_con.query('INSERT INTO voice_connections (voice_connected, voice_disconnected, voice_moved, voice_new_cha, voice_old_cha, voice_update_timestamp, members_mem_id) VALUES (?, ?, ?, ?, ?, ?, ?)', [voice_connected, voice_disconnected, voice_moved, voice_new_cha, voice_old_cha, voice_update_timestamp, members_mem_id]);
});

client.on('messageReactionAdd', async (reaction, member) => {
    let added_timestamp = Date.now();
    console.log("REACTION");
    if (reaction.partial) {
        try {
            await reaction.fetch();
        } catch (err) {
            console.log(err);
            return;
        }
    }
    db_con.query('INSERT IGNORE INTO messages_has_reactions VALUES (?, ?, ?, ?)', [reaction.message.id, reaction.emoji.id, member.id, added_timestamp]); 
})

client.on('messageReactionRemove', async (reaction, member) => {
    console.log("DELETED REACTION")
    let deleted_timestamp = Date.now();
    if (reaction.partial) {
        try {
            await reaction.fetch();
        } catch (err) {
          console.log(err);
         return;
        }
    }
    db_con.query('INSERT IGNORE INTO messages_has_deleted_reactions VALUES (?, ?, ?, ?)', [reaction.message.id, reaction.emoji.id, member.id, deleted_timestamp]);
}) 

client.on()

client.login(process.env.TOKEN);

