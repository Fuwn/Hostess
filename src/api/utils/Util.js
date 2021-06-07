/* eslint-disable no-await-in-loop */
const jetpack = require('fs-jetpack');
const randomstring = require('randomstring');
const path = require('path');
const JWT = require('jsonwebtoken');
const db = require('../structures/Database');
const moment = require('moment');
const Zip = require('adm-zip');
const uuidv4 = require('uuid/v4');

const log = require('./Log');
const ThumbUtil = require('./ThumbUtil');
const StatsGenerator = require('./StatsGenerator');

const blockedExtensions = process.env.BLOCKED_EXTENSIONS.split(',');
const preserveExtensions = ['.tar.gz', '.tar.z', '.tar.bz2', '.tar.lzma', '.tar.lzo', '.tar.xz'];

class Util {
	static uploadPath = path.join(__dirname, '../../../', process.env.UPLOAD_FOLDER);
	static statsLastSavedTime = null;
	static _config = null;

	static get config() {
		return (async () => {
			if (this._config === null) {
				const conf = await db('config').select('key', 'value');
				this._config = conf.reduce((acc, { key, value }) => {
					if (typeof value === 'string' || value instanceof String) {
						acc[key] = JSON.parse(value);
					} else {
						acc[key] = value;
					}
				}, {});
			}
			return this._config;
		})();
	}

	static invalidateConfigCache() {
		this._config = null;
	}

	static getEnvironmentDefaults() {
		return {
			routePrefix: process.env.ROUTE_PREFIX || '/api',
			rateLimitWindow: process.env.RATE_LIMIT_WINDOW || 2,
			rateLimitMax: process.env.RATE_LIMIT_MAX || 5,
			secret: process.env.SECRET || randomstring.generate(64),
			serviceName: process.env.SERVICE_NAME || 'change-me',
			domain: process.env.DOMAIN || `http://localhost:${process.env.SERVER_PORT}`,
			chunkSize: process.env.CHUNK_SIZE || 90,
			maxSize: process.env.MAX_SIZE || 5000,
			generateZips: process.env.GENERATE_ZIPS == undefined ? true : false,
			generatedFilenameLength: process.env.GENERATED_FILENAME_LENGTH || 12,
			generatedAlbumLength: process.env.GENERATED_ALBUM_LENGTH || 6,
			maxLinksPerAlbum: process.env.MAX_LINKS_PER_ALBUM || 5,
			uploadFolder: process.env.UPLOAD_FOLDER || 'uploads',
			blockedExtensions: process.env.BLOCKED_EXTENSIONS || ['.jar', '.exe', '.msi', '.com', '.bat', '.cmd', '.scr', '.ps1', '.sh'],
			publicMode: process.env.PUBLIC_MODE == undefined ? true : false,
			userAccounts: process.env.USER_ACCOUNTS == undefined ? true : false,
			adminAccount: process.env.ADMIN_ACCOUNT || 'admin',
			adminPassword: process.env.ADMIN_PASSWORD || 'admin',
			metaThemeColor: process.env.META_THEME_COLOR || '#20222b',
			metaDescription: process.env.META_DESCRIPTION || 'Blazing fast file uploader and bunker written in node! 🚀',
			metaKeywords: process.env.META_KEYWORDS || 'chibisafe,lolisafe,upload,uploader,file,vue,images,ssr,file uploader,free',
			metaTwitterHandle: process.env.META_TWITTER_HANDLE || '@your-handle'
		};
	}

	static async writeConfigToDb(config, overwrite = true) {
		// TODO: Check that the config passes the joi schema validation
		try {
			if (overwrite) {
				await db.table('settings').first().update(config);
			} else {
				await db.table('settings').insert(config);
			}
		} catch (error) {
			console.error(error);
		}
	}

	static uuid() {
		return uuidv4();
	}

	static isExtensionBlocked(extension) {
		return blockedExtensions.includes(extension);
	}

	static getMimeFromType(fileTypeMimeObj) {
		return fileTypeMimeObj ? fileTypeMimeObj.mime : undefined;
	}

	static constructFilePublicLink(file) {
		/*
			TODO: This wont work without a reverse proxy serving both
			the site and the API under the same domain. Pls fix.
		*/
		file.url = `${process.env.DOMAIN}/${file.name}`;
		const { thumb, preview } = ThumbUtil.getFileThumbnail(file.name) || {};
		if (thumb) {
			file.thumb = `${process.env.DOMAIN}/thumbs/${thumb}`;
			file.thumbSquare = `${process.env.DOMAIN}/thumbs/square/${thumb}`;
			file.preview = preview && `${process.env.DOMAIN}/thumbs/preview/${preview}`;
		}
		return file;
	}

	static getUniqueFilename(extension) {
		const retry = (i = 0) => {
			const filename = randomstring.generate({
				length: parseInt(process.env.GENERATED_FILENAME_LENGTH, 10),
				capitalization: 'lowercase'
			}) + extension;

			// TODO: Change this to look for the file in the db instead of in the filesystem
			const exists = jetpack.exists(path.join(Util.uploadPath, filename));
			if (!exists) return filename;
			if (i < 5) return retry(i + 1);
			log.error('Couldnt allocate identifier for file');
			return null;
		};
		return retry();
	}

	static getUniqueAlbumIdentifier() {
		const retry = async (i = 0) => {
			const identifier = randomstring.generate({
				length: parseInt(process.env.GENERATED_ALBUM_LENGTH, 10),
				capitalization: 'lowercase'
			});
			const exists = await db
				.table('links')
				.where({ identifier })
				.first();
			if (!exists) return identifier;
			/*
				It's funny but if you do i++ the asignment never gets done resulting in an infinite loop
			*/
			if (i < 5) return retry(i + 1);
			log.error('Couldnt allocate identifier for album');
			return null;
		};
		return retry();
	}

	static getFilenameFromPath(fullPath) {
		return fullPath.replace(/^.*[\\\/]/, ''); // eslint-disable-line no-useless-escape
	}

	static async deleteFile(filename, deleteFromDB = false) {
		const thumbName = ThumbUtil.getFileThumbnail(filename);
		try {
			await jetpack.removeAsync(path.join(Util.uploadPath, filename));
			if (thumbName) await ThumbUtil.removeThumbs(thumbName);

			if (deleteFromDB) {
				await db
					.table('files')
					.where('name', filename)
					.delete()
					.wasMutated();
			}
		} catch (error) {
			log.error(`There was an error removing the file < ${filename} >`);
			log.error(error);
		}
	}

	static async deleteAllFilesFromAlbum(id) {
		try {
			const fileAlbums = await db.table('albumsFiles').where({ albumId: id });
			for (const fileAlbum of fileAlbums) {
				const file = await db
					.table('files')
					.where({ id: fileAlbum.fileId })
					.first();

				if (!file) continue;

				await this.deleteFile(file.name, true);
			}
		} catch (error) {
			log.error(error);
		}
	}

	static async deleteAllFilesFromUser(id) {
		try {
			const files = await db.table('files').where({ userId: id });
			for (const file of files) {
				await this.deleteFile(file.name, true);
			}
		} catch (error) {
			log.error(error);
		}
	}

	static async deleteAllFilesFromTag(id) {
		try {
			const fileTags = await db.table('fileTags').where({ tagId: id });
			for (const fileTag of fileTags) {
				const file = await db
					.table('files')
					.where({ id: fileTag.fileId })
					.first();
				if (!file) continue;
				await this.deleteFile(file.name, true);
			}
		} catch (error) {
			log.error(error);
		}
	}

	static async isAuthorized(req) {
		if (req.headers.token) {
			const user = await db.table('users').where({ apiKey: req.headers.token }).first();
			if (!user || !user.enabled) return false;
			return user;
		}

		if (!req.headers.authorization) return false;
		const token = req.headers.authorization.split(' ')[1];
		if (!token) return false;

		return JWT.verify(token, process.env.SECRET, async (error, decoded) => {
			if (error) {
				log.error(error);
				return false;
			}
			const id = decoded ? decoded.sub : '';
			const iat = decoded ? decoded.iat : '';

			const user = await db
				.table('users')
				.where({ id })
				.first();
			if (!user || !user.enabled) return false;
			if (iat && iat < moment(user.passwordEditedAt).format('x')) return false;

			return user;
		});
	}

	static createZip(files, album) {
		try {
			const zip = new Zip();
			for (const file of files) {
				zip.addLocalFile(path.join(Util.uploadPath, file));
			}
			zip.writeZip(
				path.join(
					__dirname,
					'../../../',
					process.env.UPLOAD_FOLDER,
					'zips',
					`${album.userId}-${album.id}.zip`
				)
			);
		} catch (error) {
			log.error(error);
		}
	}

	static generateThumbnails = ThumbUtil.generateThumbnails;

	static async fileExists(res, exists, filename) {
		exists = Util.constructFilePublicLink(exists);
		res.json({
			message: 'Successfully uploaded the file.',
			name: exists.name,
			hash: exists.hash,
			size: exists.size,
			url: exists.url,
			thumb: exists.thumb,
			deleteUrl: `${process.env.DOMAIN}/api/file/${exists.id}`,
			repeated: true
		});

		return this.deleteFile(filename);
	}

	static async storeFileToDb(req, res, user, file, db) {
		const dbFile = await db.table('files')
			// eslint-disable-next-line func-names
			.where(function() {
				if (user === undefined) {
					this.whereNull('userId');
				} else {
					this.where('userId', user.id);
				}
			})
			.where({
				hash: file.data.hash,
				size: file.data.size
			})
			.first();

		if (dbFile) {
			await this.fileExists(res, dbFile, file.data.filename);
			return;
		}

		const now = moment.utc().toDate();
		const data = {
			userId: user ? user.id : null,
			name: file.data.filename,
			original: file.data.originalname,
			type: file.data.mimetype,
			size: file.data.size,
			hash: file.data.hash,
			ip: req.ip,
			createdAt: now,
			editedAt: now
		};
		Util.generateThumbnails(file.data.filename);

		let fileId;
		if (process.env.DB_CLIENT === 'sqlite3') {
			fileId = await db.table('files').insert(data).wasMutated();
		} else {
			fileId = await db.table('files').insert(data, 'id').wasMutated();
		}

		return {
			file: data,
			id: fileId
		};
	}

	static async saveFileToAlbum(db, albumId, insertedId) {
		if (!albumId) return;

		const now = moment.utc().toDate();
		try {
			await db.table('albumsFiles').insert({ albumId, fileId: insertedId[0] }).wasMutated();
			await db.table('albums').where('id', albumId).update('editedAt', now);
		} catch (error) {
			console.error(error);
		}
	}

	static getExtension(filename) {
		// Always return blank string if the filename does not seem to have a valid extension
		// Files such as .DS_Store (anything that starts with a dot, without any extension after) will still be accepted
		if (!/\../.test(filename)) return '';

		let lower = filename.toLowerCase(); // due to this, the returned extname will always be lower case
		let multi = '';
		let extname = '';

		// check for multi-archive extensions (.001, .002, and so on)
		if (/\.\d{3}$/.test(lower)) {
			multi = lower.slice(lower.lastIndexOf('.') - lower.length);
			lower = lower.slice(0, lower.lastIndexOf('.'));
		}

		// check against extensions that must be preserved
		for (const extPreserve of preserveExtensions) {
			if (lower.endsWith(extPreserve)) {
				extname = extPreserve;
				break;
			}
		}

		if (!extname) {
			extname = lower.slice(lower.lastIndexOf('.') - lower.length); // path.extname(lower)
		}

		return extname + multi;
	}

	// TODO: Allow choosing what to save to db and what stats we care about in general
	// TODO: if a stat is not saved to db but selected to be shows on the dashboard, it will be generated during the request
	static async saveStatsToDb(force) {
		// If there were no changes since the instance started, don't generate new stats
		// OR
		// if we alredy saved a stats to the db, and there were no new changes to the db since then
		// skip generating and saving new stats.
		if (!force &&
			(!db.userParams.lastMutationTime ||
				(Util.statsLastSavedTime && Util.statsLastSavedTime > db.userParams.lastMutationTime)
			)
		) {
			return;
		}

		const now = moment.utc().toDate();
		const stats = await StatsGenerator.getStats(db);

		let batchId = 1;

		const res = (await db('statistics').max({ lastBatch: 'batchId' }))[0];
		if (res && res.lastBatch) {
			batchId = res.lastBatch + 1;
		}

		try {
			for (const [type, data] of Object.entries(stats)) {
				await db.table('statistics').insert({ type, data: JSON.stringify(data), createdAt: now, batchId });
			}

			Util.statsLastSavedTime = now.getTime();
		} catch (error) {
			console.error(error);
		}
	}
}

module.exports = Util;
