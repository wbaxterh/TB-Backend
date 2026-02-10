#!/usr/bin/env node
/**
 * YouTube to Bunny.net Video Uploader
 *
 * Downloads a YouTube video and uploads it to Bunny.net Stream
 *
 * Usage: node youtube-to-bunny.js <youtube-url> [title]
 *
 * Requires:
 *   - yt-dlp installed (npm install -g yt-dlp or brew install yt-dlp)
 *   - ffmpeg installed
 *   - Environment variables: BUNNY_LIBRARY_ID, BUNNY_LIBRARY_API_KEY, BUNNY_CDN_HOSTNAME
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

// Bunny.net configuration
const BUNNY_LIBRARY_ID = process.env.BUNNY_LIBRARY_ID || '583522';
const BUNNY_LIBRARY_API_KEY =
  process.env.BUNNY_LIBRARY_API_KEY || '5be583ed-202a-4107-8743c71fef1f-7116-4795';
const BUNNY_CDN_HOSTNAME = process.env.BUNNY_CDN_HOSTNAME || 'vz-9b8a66dd-b7b.b-cdn.net';

const TEMP_DIR = path.join(process.cwd(), 'temp-downloads');

// Ensure temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

async function main() {
  const youtubeUrl = process.argv[2];
  const customTitle = process.argv[3];

  if (!youtubeUrl) {
    console.error('Usage: node youtube-to-bunny.js <youtube-url> [title]');
    process.exit(1);
  }

  console.log('🎬 YouTube to Bunny.net Uploader\n');

  try {
    // Step 1: Get video info from YouTube
    console.log('📥 Fetching YouTube metadata...');
    const videoInfo = JSON.parse(
      execSync(`yt-dlp --dump-json "${youtubeUrl}"`, {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      }),
    );

    const title = customTitle || videoInfo.title;
    const cleanTitle = title.replace(/[<>:"/\\|?*]/g, '').substring(0, 100);

    console.log(`📹 Title: ${title}`);
    console.log(
      `⏱️  Duration: ${Math.floor(videoInfo.duration / 60)}:${String(videoInfo.duration % 60).padStart(2, '0')}`,
    );
    console.log('');

    // Step 2: Download video
    console.log('⬇️  Downloading video from YouTube...');
    const outputPath = path.join(TEMP_DIR, `${cleanTitle}.mp4`);

    const downloadProcess = spawn(
      'yt-dlp',
      [
        '-f',
        'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        '--merge-output-format',
        'mp4',
        '-o',
        outputPath,
        '--progress',
        '--newline',
        youtubeUrl,
      ],
      { stdio: ['inherit', 'pipe', 'pipe'] },
    );

    await new Promise((resolve, reject) => {
      downloadProcess.stdout.on('data', (data) => {
        const line = data.toString();
        if (line.includes('%')) {
          const match = line.match(/(\d+\.?\d*)%/);
          if (match) {
            process.stdout.write(`\r   Download progress: ${match[1]}%`);
          }
        }
      });
      downloadProcess.stderr.on('data', (data) => {
        // yt-dlp outputs progress to stderr
        const line = data.toString();
        if (line.includes('%')) {
          const match = line.match(/(\d+\.?\d*)%/);
          if (match) {
            process.stdout.write(`\r   Download progress: ${match[1]}%`);
          }
        }
      });
      downloadProcess.on('close', (code) => {
        console.log('');
        if (code === 0) resolve();
        else reject(new Error(`yt-dlp exited with code ${code}`));
      });
    });

    console.log('✅ Download complete!\n');

    // Verify file exists
    if (!fs.existsSync(outputPath)) {
      throw new Error('Downloaded file not found');
    }

    const stats = fs.statSync(outputPath);
    const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    console.log(`📦 File size: ${fileSizeMB} MB\n`);

    // Step 3: Create video in Bunny.net
    console.log('☁️  Creating video entry in Bunny.net...');
    const bunnyVideo = await createBunnyVideo(title);
    console.log(`   Video ID: ${bunnyVideo.guid}\n`);

    // Step 4: Upload to Bunny.net
    console.log('⬆️  Uploading to Bunny.net Stream...');
    await uploadToBunny(bunnyVideo.guid, outputPath);
    console.log('\n✅ Upload complete!\n');

    // Step 5: Output results
    console.log('═══════════════════════════════════════════════════════');
    console.log('🎉 SUCCESS! Video uploaded to Bunny.net');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`📹 Title: ${title}`);
    console.log(`🆔 Bunny Video ID: ${bunnyVideo.guid}`);
    console.log(`🔗 HLS URL: https://${BUNNY_CDN_HOSTNAME}/${bunnyVideo.guid}/playlist.m3u8`);
    console.log(`🖼️  Thumbnail: https://${BUNNY_CDN_HOSTNAME}/${bunnyVideo.guid}/thumbnail.jpg`);
    console.log(`📺 YouTube: ${youtubeUrl}`);
    console.log('═══════════════════════════════════════════════════════\n');

    // Output JSON for piping to other tools
    const result = {
      success: true,
      bunnyVideoId: bunnyVideo.guid,
      title: title,
      hlsUrl: `https://${BUNNY_CDN_HOSTNAME}/${bunnyVideo.guid}/playlist.m3u8`,
      thumbnailUrl: `https://${BUNNY_CDN_HOSTNAME}/${bunnyVideo.guid}/thumbnail.jpg`,
      youtubeUrl: youtubeUrl,
      duration: videoInfo.duration,
    };

    console.log('📋 JSON Output:');
    console.log(JSON.stringify(result, null, 2));

    // Cleanup
    console.log('\n🧹 Cleaning up temp files...');
    fs.unlinkSync(outputPath);
    console.log('✅ Done!\n');
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

async function createBunnyVideo(title) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ title });

    const options = {
      hostname: 'video.bunnycdn.com',
      port: 443,
      path: `/library/${BUNNY_LIBRARY_ID}/videos`,
      method: 'POST',
      headers: {
        AccessKey: BUNNY_LIBRARY_API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': data.length,
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 201) {
          resolve(JSON.parse(body));
        } else {
          reject(new Error(`Bunny API error: ${res.statusCode} - ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function uploadToBunny(videoId, filePath) {
  return new Promise((resolve, reject) => {
    const stats = fs.statSync(filePath);
    const fileSize = stats.size;
    let uploaded = 0;

    const options = {
      hostname: 'video.bunnycdn.com',
      port: 443,
      path: `/library/${BUNNY_LIBRARY_ID}/videos/${videoId}`,
      method: 'PUT',
      headers: {
        AccessKey: BUNNY_LIBRARY_API_KEY,
        'Content-Type': 'application/octet-stream',
        'Content-Length': fileSize,
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 201) {
          resolve(JSON.parse(body || '{}'));
        } else {
          reject(new Error(`Upload error: ${res.statusCode} - ${body}`));
        }
      });
    });

    req.on('error', reject);

    // Stream the file and track progress
    const fileStream = fs.createReadStream(filePath);

    fileStream.on('data', (chunk) => {
      uploaded += chunk.length;
      const percent = ((uploaded / fileSize) * 100).toFixed(1);
      process.stdout.write(`\r   Upload progress: ${percent}%`);
    });

    fileStream.pipe(req);
  });
}

main();
