/*
    Simple webhook for posting memes from Klei forums.

    Every time this file is executed, it will post the next meme from the configured forum thread
    remembering the page and comment index of the last one.
*/


const config = require("config")
const cheerio = require("cheerio")

if (config.has("discord_webhook_url")) {
    throw new Error("'discord_webhook_url' not configured! Add it to default.json or local.json files in the config folder.")
}

//////////////////////////////

function normalizeUrl(url) {
    return url.startsWith('https://') ? url : 'https://' + url;
}

async function getPageMetadata(pageIndex) {
    const metadata = {}

    const url = `${config.get("forum_post_url")}/page/${pageIndex}/`;
    const response = await fetch(url);
    const responseText = await response.text();
    const $ = cheerio.load(responseText);

    metadata.postName = $("meta[property='og:title']").attr("content");
    metadata.comments = [];

    $("article").each(function (index) {
        console.log(index)
        const comment_content = $(this).find("[data-role='commentContent']")
        const comment = {
            author: {
                name: $(this).find("span[id='cAuthorPane_author']").first().text(),
                url: normalizeUrl($(this).find("a.ipsUserPhoto").attr("href")),
                icon_url: normalizeUrl($(this).find("a.ipsUserPhoto ").find("img").attr("src"))
            },
            description: comment_content.text().trim(),
            timestamp: $(this).find("time").attr("datetime")
        }

        if ($(this).find("div.ipsQuote_citation").length > 0) {
            return; // Ignore quote comments
        };

        const images = comment_content.find("img.ipsImage.ipsImage_thumbnailed[src]")
        if(images.length != 1) {
            return; // Ignore comments with more than one image (supports gifs as well)
        }

        comment.image = {
            url: normalizeUrl(images.first().attr("src")),
        }
        metadata.comments.push(comment);
    })

    return metadata;
}

function postMeme(comment, name) {
    const payload = {
        username: name,
        allowed_mentions: { parse: [] },
        embeds: [comment]
    };

    fetch(config.get("discord_webhook_url"), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }).then(response => console.log(response.status));
}

getPageMetadata(2)
    .then(function (metadata) {
        metadata.comments.forEach(function (comment) {
            postMeme(comment, metadata.postName)
        })
    });
