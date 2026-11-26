// Curated list of well-known disposable / temporary / throwaway email domains.
// Matching is subdomain-aware: listing `mailinator.com` also covers `x.mailinator.com`.
// Kept as one space-separated string so it stays small in the bundle.
// Add your own with the `blockDomains` option; exempt a domain with `allowDomains`.
const LIST = `
0-mail.com 0815.ru 0815.su 0clickemail.com 0wnd.net 0wnd.org 10mail.com 10mail.org 10minutemail.be
10minutemail.cf 10minutemail.co.uk 10minutemail.co.za 10minutemail.com 10minutemail.de
10minutemail.ga 10minutemail.gq 10minutemail.info 10minutemail.ml 10minutemail.net 10minutemail.nl
10minutemail.org 10minutemail.pro 10minutemail.us 10minutesmail.com 10minutesmail.net 10x9.com
12minutemail.com 12minutemail.net 15qm.com 1secmail.com 1secmail.net 1secmail.org 20mail.eu
20mail.it 20minutemail.com 20minutemail.it 2prong.com 30minutemail.com 33mail.com 4warding.com
4warding.net 4warding.org 60minutemail.com 675hosting.com 675hosting.net 675hosting.org 6ip.us
6paq.com 6url.com 75hosting.com 75hosting.net 75hosting.org 7tags.com 9ox.net a-bc.net abyssmail.com
afrobacon.com ajaxapp.net amilegit.com anonbox.net anonymbox.com antichef.com antichef.net
antispam.de armyspy.com beefmilk.com binkmail.com bio-muesli.net bobmail.info bofthew.com
boximail.com brefmail.com bugmenot.com bumpymail.com byom.de chammy.info chogmail.com
choicemail1.com clrmail.com cool.fr.nf correo.blogos.net cosmorph.com courriel.fr.nf
courrieltemporaire.com crazymailing.com curryworld.de cust.in cuvox.de dacoolest.com dandikmail.com
dayrep.com deadaddress.com deadspam.com despam.it despammed.com devnullmail.com dfgh.net
digitalsanctuary.com disbox.net disbox.org discard.email discardmail.com discardmail.de
disposableaddress.com disposableemailaddresses.com disposableinbox.com dispose.it disposeamail.com
disposemail.com dispostable.com dodgeit.com dodgit.com dodgit.org donemail.ru dontreg.com
dontsendmespam.de dropjar.com dropmail.me dump-email.info dumpandjunk.com dumpmail.de dumpyemail.com
e4ward.com einrot.com email-fake.com email60.com emaildienst.de emailfake.com emailias.com
emailigo.de emailinfive.com emailmiser.com emailondeck.com emailsensei.com emailtemporario.com.br
emailthe.net emailtmp.com emailwarden.com emailxfer.com emlhub.com emlpro.com emltmp.com emz.net
enterto.com ephemail.net esiix.com etranquil.com etranquil.net etranquil.org explodemail.com
eyepaste.com ezztt.com fakeinbox.com fakeinformation.com fakemail.fr fakemail.net
fakemailgenerator.com fastacura.com fastchevy.com fastchrysler.com fastkawasaki.com fastmazda.com
fastmitsubishi.com fastnissan.com fastsubaru.com fastsuzuki.com fasttoyota.com fastyamaha.com
fexbox.org fexpost.com filzmail.com fizmail.com fleckens.hu footard.com forgetmail.com fr33mail.info
frapmail.com freeml.net friendlymail.co.uk front14.org fudgerub.com garliclife.com generator.email
get1mail.com get2mail.fr getairmail.com getmails.eu getnada.com getonemail.com getonemail.net
ghosttexter.de girlsundertheinfluence.com gishpuppy.com givmail.com great-host.in greensloth.com
grr.la guerillamail.biz guerillamail.com guerillamail.de guerillamail.info guerillamail.net
guerillamail.org guerrillamail.biz guerrillamail.com guerrillamail.de guerrillamail.info
guerrillamail.net guerrillamail.org guerrillamailblock.com gustr.com h8s.org haltospam.com
harakirimail.com hatespam.org hidemail.de hochsitze.com hulapla.de icznn.com ieatspam.eu
ieatspam.info ihateyoualot.info iheartspam.org imails.info inboxalias.com inboxbear.com
inboxclean.com inboxclean.org inboxkitten.com incognitomail.com incognitomail.net incognitomail.org
insorg-mail.info ipoo.org irish2me.com jetable.com jetable.fr.nf jetable.net jetable.org jnxjn.com
jourrapide.com junk1e.com kasmail.com kaspop.com keepmymail.com killmail.com killmail.net
klassmaster.com klassmaster.net klzlk.com kulturbetrieb.info kurzepost.de kzccv.com
letthemeatspam.com lhsdv.com lifebyfood.com link2mail.net litedrop.com lookugly.com lortemail.dk
lr78.com m4ilweb.info maboard.com mail-temporaire.fr mail.by mail2rss.org mail333.com mail4trash.com
mailbidon.com mailcatch.com maildrop.cc maileater.com mailexpire.com mailforspam.com
mailfreeonline.com mailhazard.com mailhazard.us mailin8r.com mailinater.com mailinator.com
mailinator.net mailinator.org mailinator2.com mailincubator.com mailismagic.com mailme.lv
mailme24.com mailmetrash.com mailmoat.com mailnator.com mailnesia.com mailnull.com mailpoof.com
mailquack.com mailsac.com mailscrap.com mailsiphon.com mailslite.com mailtemp.info mailto.plus
mailtome.de mailtothis.com mailzilla.com mailzilla.org makemetheking.com manybrain.com mbx.cc
mega.zik.dj meinspamschutz.de meltmail.com merepost.com messagebeamer.de mierdamail.com
mintemail.com moakt.cc moakt.co moakt.com moakt.ws moburl.com mohmal.com moncourrier.fr.nf
monemail.fr.nf monmail.fr.nf mt2009.com mt2014.com mt2015.com mvrht.com mvrht.net mycleaninbox.net
mypartyclip.de myphantomemail.com myspaceinc.com myspaceinc.net myspaceinc.org myspacepimpedup.com
myspamless.com mytemp.email mytempemail.com mytempmail.com mytrashmail.com nada.email nepwk.com
nervmich.net nervtmich.net netzidiot.de neverbox.com no-spam.ws nobulk.com noclickemail.com
nogmailspam.info nomail.xl.cx nomail2me.com nomorespamemails.com nospam.ze.tc nospam4.us
nospamfor.us nospamthanks.info notmailinator.com nowmymail.com nurfuerspam.de nwldx.com
objectmail.com obobbo.com oneoffemail.com onewaymail.com oopi.org oosln.com ordinaryamerican.net
ourklips.com outlawspam.com ovpn.to owlpic.com pancakemail.com pimpedupmyspace.com pjjkp.com
pokemail.net politikerclub.de poofy.org pookmail.com proxymail.eu prtnx.com punkass.com
putthisinyourspamdatabase.com qiott.com quickinbox.com rcpt.at reallymymail.com recode.me
reconmail.com recursor.net regbypass.com rejectmail.com rhyta.com rklips.com rmqkr.net
robot-mail.com rppkn.com rtrtr.com s0ny.net safersignup.de safetymail.info safetypost.de sandelf.de
saynotospams.com selfdestructingmail.com sendspamhere.com sharklasers.com shieldedmail.com
shiftmail.com shitmail.me shortmail.net skeefmail.com slaskpost.se slopsbox.com smashmail.de
smellfear.com snakemail.com sneakemail.com sofimail.com sofort-mail.de sogetthis.com soodonims.com
spam.la spam.su spam4.me spamavert.com spambob.com spambob.net spambob.org spambog.com spambog.de
spambog.ru spambooger.com spambox.info spambox.us spamcannon.com spamcannon.net spamcero.com
spamcon.org spamcorptastic.com spamcowboy.com spamcowboy.net spamcowboy.org spamday.com spamex.com
spamfree24.com spamfree24.de spamfree24.eu spamfree24.info spamfree24.net spamfree24.org
spamgourmet.com spamgourmet.net spamgourmet.org spamherelots.com spamhereplease.com spamhole.com
spamify.com spaminator.de spamkill.info spaml.com spaml.de spammotel.com spamobox.com spamoff.de
spamslicer.com spamspot.com spamthis.co.uk spamthisplease.com spamtrail.com speed.1s.fr spymail.one
streetwisemail.com supergreatmail.com supermailer.jp superrito.com suremail.info tafmail.com
tagyourself.com teewars.org teleworm.com teleworm.us temp-mail.io temp-mail.org temp-mail.ru
tempail.com tempalias.com tempe-mail.com tempemail.biz tempemail.com tempemail.net tempinbox.co.uk
tempinbox.com tempmail.it tempmail2.com tempmaildemo.com tempmailer.com tempmailer.de tempmailo.com
tempomail.fr temporarily.de temporarioemail.com.br temporaryemail.net temporaryforwarding.com
temporaryinbox.com tempr.email thanksnospam.info thankyou2010.com thisisnotmyrealemail.com
throwam.com throwawayemailaddress.com throwawaymail.com tilien.com tmail.ws tmailinator.com
tmpbox.net tmpeml.com tmpmail.net tmpmail.org toiea.com tradermail.info trash-amil.com trash-mail.at
trash-mail.com trash-mail.de trash2009.com trashdevil.com trashdevil.de trashemail.de trashmail.at
trashmail.com trashmail.de trashmail.me trashmail.net trashmail.org trashmail.ws trashmailer.com
trashymail.com trashymail.net trbvm.com turual.com twinmail.de tyldd.com uggsrock.com upliftnow.com
uplipht.com vddaz.com venompen.com veryrealemail.com viditag.com viewcastmedia.com viewcastmedia.net
viewcastmedia.org vomoto.com webm4il.info wegwerfadresse.de wegwerfemail.de wegwerfmail.de
wegwerfmail.net wegwerfmail.org wetrainbayarea.com wetrainbayarea.org wh4f.org whyspam.me
willselfdestruct.com winemaven.info wronghead.com wuuvo.com wuzup.net wuzupmail.net wwjmp.com
wwwnew.eu xagloo.com xemaps.com xents.com xmaily.com xojxe.com xoxy.net yep.it yogamaven.com
yoggm.com yomail.info yopmail.com yopmail.fr yopmail.net yuurok.com zehnminutenmail.de zetmail.com
zippymail.info zoaxe.com zoemail.org
`;

/** The built-in disposable domain list (lowercase ASCII, sorted). */
export const disposableDomains: readonly string[] = Object.freeze(LIST.trim().split(/\s+/));
