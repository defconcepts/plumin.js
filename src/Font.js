var opentype = require('../node_modules/opentype.js/dist/opentype.js'),
	paper = require('../node_modules/paper/dist/paper-core.js'),
	Glyph = require('./Glyph.js');

function Font( args ) {
	paper.Group.prototype.constructor.apply( this );

	if ( !args ) {
		args = {};
	}

	if ( !args.styleName ) {
		args.styleName = 'Regular';
	}

	if ( !args.unitsPerEm ) {
		args.unitsPerEm = 1024;
	}

	this.fontinfo = this.ot = new opentype.Font( args );

	this.glyphMap = {};
	this.charMap = {};
	this.altMap = {};
	this._subset = false;

	this.addGlyph(new Glyph({
		name: '.notdef',
		unicode: 0
	}));

	if ( args && args.glyphs ) {
		this.addGlyphs( args.glyphs );
	}

	if ( typeof window === 'object' && window.document ) {
		// work around https://bugzilla.mozilla.org/show_bug.cgi?id=1100005
		// by using fonts.delete in batch, every 1 second
		if ( document.fonts ) {
			this.addedFonts = [];

			setInterval(function() {
				while ( this.addedFonts.length > 1 ) {
					document.fonts.delete( this.addedFonts.shift() );
				}
			}.bind(this), 1000);

		} else {
			document.head.appendChild(
				this.styleElement = document.createElement('style')
			);
			// let's find the corresponding CSSStyleSheet
			// (would be much easier with Array#find)
			this.styleSheet = document.styleSheets[
				[].map.call(document.styleSheets, function(ss) {
					return ss.ownerNode;
				}).indexOf(this.styleElement)
			];
		}
	}
}

Font.prototype = Object.create(paper.Group.prototype);
Font.prototype.constructor = Font;

// proxy .glyphs to .children
// TODO: handle unicode updates
Object.defineProperty(
	Font.prototype,
	'glyphs',
	Object.getOwnPropertyDescriptor( paper.Item.prototype, 'children' )
);

// TODO: proper proxying of ...Glyph[s] methods to ...Child[ren] methods
// see Glyph.js
Font.prototype.addGlyph = function( glyph ) {
	this.addChild( glyph );
	this.glyphMap[glyph.name] = glyph;

	if ( glyph.ot.unicode === undefined ) {
		return glyph;
	}

	// build the default cmap
	// if multiple glyphs share the same unicode, use the glyph where unicode
	// and name are equal
	if ( !this.charMap[glyph.ot.unicode] ||
			( glyph.name.length === 1 &&
				glyph.name.charCodeAt(0) === glyph.ot.unicode ) ) {

		this.charMap[glyph.ot.unicode] = glyph;
	}

	// build the alternates map
	if ( !this.altMap[glyph.ot.unicode] ) {
		this.altMap[glyph.ot.unicode] = [];
	}
	this.altMap[glyph.ot.unicode].push( glyph );

	// invalidate glyph subset cache
	// TODO: switch to immutable.js to avoid this maddness
	this._lastSubset = undefined;

	return glyph;
};

Font.prototype.addGlyphs = function( glyphs ) {
	return glyphs.forEach(function( glyph ) {
		this.addGlyph(glyph);

	}, this);
};

Object.defineProperty( Font.prototype, 'subset', {
	get: function() {
		if ( !this._subset ) {
			this._subset = this.normalizeSubset( false );
		}
		return this._subset;
	},
	set: function( set ) {
		this._subset = this.normalizeSubset( set );
	}
});

Font.prototype.normalizeSubset = function( _set ) {
	var set;

	// two cases where _set isn't an array
	// false set = all glyphs in the charMap
	if ( _set === false ) {
		set = Object.keys( this.charMap ).map(function( unicode ) {
			return this.charMap[unicode];
		}.bind(this));

	// convert string to array of chars
	} else if ( typeof _set === 'string' ) {
		set = _set.split('').map(function(e) {
			return e.charCodeAt(0);
		});

	} else {
		set = _set;
	}

	// convert array of number to array of glyphs
	if ( Array.isArray( set ) && typeof set[0] === 'number' ) {
		set = set.map(function( unicode ) {
			return this.charMap[ unicode ];
		}.bind(this));
	}

	// always include .undef
	if ( set.indexOf( this.glyphMap['.notdef'] ) === -1 ) {
		set.unshift( this.glyphMap['.notdef'] );
	}

	// remove undefined glyphs and dedupe the set
	return set.filter(function(e, i, arr) {
		return e && arr.lastIndexOf(e) === i;
	});
};

Font.prototype.getGlyphSubset = function( _set ) {
	return _set !== undefined ? this.normalizeSubset( _set ) : this.subset;
};

Font.prototype.setAlternateFor = function( unicode, glyphName ) {
	this.charMap[ unicode ] = this.glyphMap[ glyphName ];
};

Font.prototype.interpolate = function( font0, font1, coef, set ) {
	this.getGlyphSubset( set ).map(function( glyph ) {
		glyph.interpolate(
			font0.glyphMap[glyph.name],
			font1.glyphMap[glyph.name],
			coef
		);
	});

	// TODO: evaluate if taking subsetting into account makes kerning
	// interpolation faster or slower.
	if ( this.ot.kerningPairs ) {
		for ( var i in this.ot.kerningPairs ) {
			this.ot.kerningPairs[i] =
				font0.ot.kerningPairs[i] +
				( font1.ot.kerningPairs[i] - font0.ot.kerningPairs[i] ) * coef;
		}
	}

	this.ot.ascender =
		font0.ot.ascender + ( font1.ot.ascender - font0.ot.ascender ) * coef;
	this.ot.descender =
		font0.ot.descender + ( font1.ot.descender - font0.ot.descender ) * coef;

	return this;
};

Font.prototype.updateSVGData = function( set ) {
	this.getGlyphSubset( set ).map(function( glyph ) {
		return glyph.updateSVGData();
	});

	return this;
};

Font.prototype.updateOTCommands = function( set, united ) {
	this.ot.glyphs = this.getGlyphSubset( set ).map(function( glyph ) {
		return glyph.updateOTCommands( null, united);
	});

	return this;
};

Font.prototype.importOT = function( otFont ) {
	this.ot = otFont;

	otFont.glyphs.forEach(function( otGlyph ) {
		var glyph = new Glyph({
				name: otGlyph.name,
				unicode: otGlyph.unicode
			});

		this.addGlyph( glyph );
		glyph.importOT( otGlyph );

	}, this);

	return this;
};

if ( typeof window === 'object' && window.document ) {

	var _URL = window.URL || window.webkitURL;
	Font.prototype.addToFonts = document.fonts ?
		// CSS font loading, lightning fast
		function( buffer ) {
			var fontface = new window.FontFace(
				this.ot.familyName,
				buffer || this.ot.toBuffer()
			);

			document.fonts.add( fontface );
			this.addedFonts.push( fontface );

			return this;
		} :
		function( buffer ) {
			var url = _URL.createObjectURL(
					new Blob(
						[ new DataView( buffer || this.ot.toBuffer() ) ],
						{ type: 'font/opentype' }
					)
				);

			if ( this.fontObjectURL ) {
				_URL.revokeObjectURL( this.fontObjectURL );
				this.styleSheet.deleteRule(0);
			}

			this.styleSheet.insertRule(
				'@font-face { font-family: "' + this.ot.familyName + '";' +
				'src: url(' + url + '); }',
				0
			);
			this.fontObjectURL = url;

			return this;
		};

	var a = document.createElement('a');

	Font.prototype.downloadFromLink = function( buffer ) {
			var reader = new FileReader(),
				familyName = this.ot.familyName;

			reader.onloadend = function() {
				a.download = familyName + '.otf';
				a.href = reader.result;
				a.dispatchEvent(new MouseEvent('click'));

				setTimeout(function() {
					a.href = '#';
					_URL.revokeObjectURL( reader.result );
				}, 100);
			};

			reader.readAsDataURL(new Blob(
				[ new DataView( buffer || this.ot.toBuffer() ) ],
				{ type: 'font/opentype' }
			));
	};

	Font.prototype.download = function( buffer, merged, name, user ) {
		if ( merged ) {
			var headers = new Headers();
			headers.append('Content-Type', 'application/otf');

			fetch('http://fontforgeconv.cloudapp.net/' + name + '/' + user, {
					method: 'POST',
					headers: headers,
					body: buffer
				})
				.then(function( response ) {

					response.arrayBuffer()
						.then(function( bufferToDownload ) {
							this.downloadFromLink(bufferToDownload);
						}.bind(this));

				}.bind(this))
				.catch(function(err) {
					console.log('error: ', err);
				});

		} else {
			this.downloadFromLink( buffer );

			return this;
		}
	};

}

module.exports = Font;
