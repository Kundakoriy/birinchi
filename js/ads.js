/*
 * ads.js — the ONLY place in the codebase that talks to an ad / SDK.
 *
 * Single interface used by the game:
 *     Ads.showInterstitial()        -> Promise (resolves when ad finished/closed)
 *     Ads.showRewarded(onReward)    -> calls onReward(true) if the reward is earned
 *     Ads.gameplayStart()           -> signal active gameplay (mute ads etc.)
 *     Ads.gameplayStop()            -> signal gameplay paused/ended
 *     Ads.init()                    -> load the selected SDK
 *
 * Implementation is chosen by BUILD_TARGET (see config.js):
 *     'gd'    -> GameDistribution HTML5 SDK
 *     'crazy' -> CrazyGames HTML5 SDK v3 (incl. gameplayStart / gameplayStop)
 *     'none'  -> itch.io / local debug (fake ads, console only)
 *
 * No other module may reference window.gdsdk / window.CrazyGames / etc.
 */
(function (root) {
  'use strict';

  var Config = root.Config || {};
  var TARGET = Config.BUILD_TARGET || 'none';
  var DEBUG_FAKE = Config.ADS_DEBUG_FAKE !== false; // fake ads in 'none'

  function log() {
    if (Config.DEBUG) {
      var a = ['[ads:' + TARGET + ']'].concat([].slice.call(arguments));
      console.log.apply(console, a);
    }
  }

  // --- A small "fake ad" used by the 'none' target and as a fallback. --------
  function fakeAd(label, ms) {
    log('FAKE ' + label + ' ad');
    return new Promise(function (resolve) {
      if (!DEBUG_FAKE) return resolve();
      // Show a lightweight overlay so debug builds visibly "play" an ad.
      var el = document.createElement('div');
      el.className = 'fake-ad-overlay';
      el.innerHTML = '<div class="fake-ad-card"><div class="fake-ad-tag">DEBUG AD · ' +
        label + '</div><div class="fake-ad-bar"><i></i></div></div>';
      document.body.appendChild(el);
      setTimeout(function () {
        el.parentNode && el.parentNode.removeChild(el);
        resolve();
      }, ms || 1400);
    });
  }

  // --- Script loader ---------------------------------------------------------
  function loadScript(src, attrs) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      if (attrs) Object.keys(attrs).forEach(function (k) { s.setAttribute(k, attrs[k]); });
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  // ===========================================================================
  // GameDistribution implementation
  // ===========================================================================
  var GD = {
    ready: false,
    init: function () {
      window.GD_OPTIONS = {
        gameId: Config.GD_GAME_ID,
        onEvent: function (event) {
          switch (event.name) {
            case 'SDK_GAME_START': GD._resume && GD._resume(); break;
            case 'SDK_GAME_PAUSE': break;
            case 'SDK_READY': GD.ready = true; break;
          }
        }
      };
      return loadScript('https://html5.api.gamedistribution.com/main.min.js')
        .then(function () { log('GD sdk loaded'); })
        .catch(function () { log('GD sdk failed -> fake'); });
    },
    showInterstitial: function () {
      if (window.gdsdk && window.gdsdk.showAd) {
        log('GD interstitial');
        return Promise.resolve(window.gdsdk.showAd('interstitial')).catch(function () {});
      }
      return fakeAd('interstitial');
    },
    showRewarded: function (onReward) {
      if (window.gdsdk && window.gdsdk.showAd) {
        log('GD rewarded');
        return Promise.resolve(window.gdsdk.showAd('rewarded'))
          .then(function () { onReward && onReward(true); })
          .catch(function () { onReward && onReward(false); });
      }
      return fakeAd('rewarded').then(function () { onReward && onReward(true); });
    },
    gameplayStart: function () { window.gdsdk && window.gdsdk.preloadAd && log('GD play start'); },
    gameplayStop: function () { log('GD play stop'); }
  };

  // ===========================================================================
  // CrazyGames implementation (SDK v3)
  // ===========================================================================
  var Crazy = {
    sdk: null,
    init: function () {
      return loadScript('https://sdk.crazygames.com/crazygames-sdk-v3.js')
        .then(function () {
          Crazy.sdk = window.CrazyGames && window.CrazyGames.SDK;
          return Crazy.sdk && Crazy.sdk.init ? Crazy.sdk.init() : null;
        })
        .then(function () { log('Crazy sdk ready'); })
        .catch(function () { log('Crazy sdk failed -> fake'); });
    },
    showInterstitial: function () {
      var sdk = Crazy.sdk;
      if (sdk && sdk.ad && sdk.ad.requestAd) {
        log('Crazy midgame ad');
        return new Promise(function (resolve) {
          sdk.ad.requestAd('midgame', {
            adFinished: resolve, adError: resolve, adStarted: function () {}
          });
        });
      }
      return fakeAd('interstitial');
    },
    showRewarded: function (onReward) {
      var sdk = Crazy.sdk;
      if (sdk && sdk.ad && sdk.ad.requestAd) {
        log('Crazy rewarded ad');
        return new Promise(function (resolve) {
          sdk.ad.requestAd('rewarded', {
            adFinished: function () { onReward && onReward(true); resolve(); },
            adError: function () { onReward && onReward(false); resolve(); },
            adStarted: function () {}
          });
        });
      }
      return fakeAd('rewarded').then(function () { onReward && onReward(true); });
    },
    gameplayStart: function () {
      Crazy.sdk && Crazy.sdk.game && Crazy.sdk.game.gameplayStart && Crazy.sdk.game.gameplayStart();
      log('Crazy gameplayStart');
    },
    gameplayStop: function () {
      Crazy.sdk && Crazy.sdk.game && Crazy.sdk.game.gameplayStop && Crazy.sdk.game.gameplayStop();
      log('Crazy gameplayStop');
    }
  };

  // ===========================================================================
  // None / local debug (itch.io)
  // ===========================================================================
  var None = {
    init: function () { log('no-SDK build (fake ads)'); return Promise.resolve(); },
    showInterstitial: function () { return fakeAd('interstitial'); },
    showRewarded: function (onReward) {
      return fakeAd('rewarded').then(function () { onReward && onReward(true); });
    },
    gameplayStart: function () { log('gameplayStart'); },
    gameplayStop: function () { log('gameplayStop'); }
  };

  var IMPL = TARGET === 'gd' ? GD : TARGET === 'crazy' ? Crazy : None;

  root.Ads = {
    target: TARGET,
    init: function () { try { return IMPL.init(); } catch (e) { log('init err', e); return Promise.resolve(); } },
    showInterstitial: function () {
      if (!Config.ADS_ENABLED) return Promise.resolve();
      try { return IMPL.showInterstitial(); } catch (e) { return fakeAd('interstitial'); }
    },
    showRewarded: function (onReward) {
      if (!Config.ADS_ENABLED) { onReward && onReward(true); return Promise.resolve(); }
      try { return IMPL.showRewarded(onReward); }
      catch (e) { return fakeAd('rewarded').then(function () { onReward && onReward(true); }); }
    },
    gameplayStart: function () { try { IMPL.gameplayStart(); } catch (e) {} },
    gameplayStop: function () { try { IMPL.gameplayStop(); } catch (e) {} }
  };
})(typeof self !== 'undefined' ? self : this);
