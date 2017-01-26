/**
 * File Information
 * =============================================================================
 * @overview  Partner Module Template
 * @version   1.0.0
 * @author  Index Exchange
 * @copyright Copyright (C) 2016 Index Exchange All Rights Reserved.
 *
 * The information contained within this document is confidential, copyrighted
 * and or a trade secret. No part of this document may be reproduced or
 * distributed in any form or by any means, in whole or in part, without the
 * prior written permission of Index Exchange.
 * -----------------------------------------------------------------------------
 */
(function () {
    'use strict';

    var PARTNER_ID = 'CRTB';

    var SUPPORTED_TARGETING_TYPES = {
        slot: true
    };

    var SUPPORTED_ANALYTICS = {
        time: true,
        demand: true
    };

    var SUPPORTED_OPTIONS = {
        prefetch: true,
        demandExpiry: 30000
    };

    var roundingTypes = {
        FLOOR: 1,
        ROUND: 2,
        CEIL: 3
    };

    var requestedImpIDs = [];
    var ads = {};
    var prefetchState = {
        NEW: 1,
        IN_PROGRESS: 2,
        READY: 3,
        USED: 4
    };

    var profileID = 154; // Unique indentifier provided by Criteo

    var targetKeys = {
        'om': 'ix_cdb_om',
        'id': 'ix_cdb_id'
    };

    var defaultRounding = {
        'type': roundingTypes.FLOOR,
        'buckets': [{
            'range': [0, Number.POSITIVE_INFINITY],
            'granularity': 0.01
        }]
    };

    // Calling Criteo API for bid constructions
    window.Criteo = window.Criteo || {};
    window.Criteo.events = window.Criteo.events || [];

    var Utils = window.headertag.Utils;

    function validateTargetingType(tt) {
        return typeof tt === 'string' && SUPPORTED_TARGETING_TYPES[tt];
    }

    function validateQuotedInteger(obj) {
        return typeof obj === 'string' && obj.match(/^\d+$/);
    }

    function init(config, callback) {

        var err = [];

        if (!config.hasOwnProperty('targetingType') || !validateTargetingType(config.targetingType)) {
            err.push('criteobidder.init: targetingType either not provided or invalid.');
        }

        if (config.hasOwnProperty('targetKeyOverride') && (!Utils.validateNonEmptyObject(config.targetKeyOverride))) {
            err.push('criteobidder.init: targetKeyOverride provided is invalid.');
        }

        if (!config.hasOwnProperty('slots') || !Utils.validateNonEmptyObject(config.slots)) {
            err.push('criteobidder.init: slots either not provided or invalid.');
        } else {
            for (var slotID in config.slots) {
                var slotArray = config.slots[slotID];
                if (!Utils.validateNonEmptyArray(slotArray)) {
                    err.push('criteobidder.init: slotID ' + slotID + ' in config.slots is not an array');
                } else {
                    for (var i = 0; i < slotArray.length; i++) {
                        var slotObj = slotArray[i];
                        if (!slotObj.hasOwnProperty('zoneID')) {
                            err.push('criteobidder.init: slotID ' + slotID + ' in config.slots does not have zoneID key');
                        } else {
                            var zoneID = slotObj.zoneID;
                            if (!(validateQuotedInteger(zoneID) || Utils.isInteger(zoneID))) {
                                err.push('criteobidder.init: slotID ' + slotID + ' in config.slots has non-integer zoneID');
                            }
                        }
                    }
                }
            }
        }

        if (config.hasOwnProperty('isAudit') && (!Utils.validateBoolean(config.isAudit))) {
            err.push('isAudit provided is invalid.');
        }

        if (config.hasOwnProperty('roundingBuckets') && (!Utils.validateNonEmptyObject(config.roundingBuckets))) {
            err.push('roundingBuckets provided is invalid.');
        }

        if (err.length) {
            callback(err);
            return;
        }

        window.headertag.CriteoModule = window.headertag.CriteoModule || {};
        window.headertag.CriteoModule.render = function (doc, targetMap, width, height) {

            if (doc && targetMap && width && height) {
                try {
                    var slotID = targetMap[targetKeys.id][0]; // this 'ix_cdb_id' must be overridable
                    var adObject = ads[slotID][width + 'x' + height];
                    if (adObject) {
                        var ad = adObject.html;
                        if (ad) {
                            doc.write(ad);
                            doc.close();
                        } else {
                            //? if (DEBUG) {
                            console.log('Error trying to write ad. No ad for ad unit id: ' + slotID);
                            //? }
                        }
                    }
                } catch (e) {
                    //? if (DEBUG) {
                    console.log('Error trying to write to the page:');
                    //? }
                }
            } else {
                //? if (DEBUG) {
                console.log('Error trying to write ad to the page. Missing document, targetMap, width, height');
                //? }
            }
        };

        var src = '//static.criteo.net/js/ld/publishertag.js';
        Utils.addScriptTag(src, true, function () {});
        callback(null, new Partner(config));
    }

    function Partner(config) {
        var _this = this;

        var targetingType = config.targetingType;
        var supportedAnalytics = SUPPORTED_ANALYTICS;
        var supportedOptions = SUPPORTED_OPTIONS;

        var prefetch = {
            state: prefetchState.NEW,
            correlator: null,
            gCorrelator: null,
            slotIds: [],
            callbacks: []
        };

        var demandStore = {};

        var targetKeyOverride = targetKeys;

        var auctionID = 0;

        if (config.hasOwnProperty('targetKeyOverride')) {
            if (config.targetKeyOverride.hasOwnProperty('om') && Utils.validateNonEmptyString(config.targetKeyOverride.om)) {
                if (config.targetKeyOverride.om.length <= 20) {
                    targetKeyOverride.om = config.targetKeyOverride.om;
                }
            }

            if (config.targetKeyOverride.hasOwnProperty('id') && Utils.validateNonEmptyString(config.targetKeyOverride.id)) {
                if (config.targetKeyOverride.id.length <= 20) {
                    targetKeyOverride.id = config.targetKeyOverride.id;
                }
            }
        }

        var configSlots = config.slots;
        var isAudit = config.isAudit || false;
        var roundingBuckets = config.roundingBuckets || defaultRounding;

        this.getPartnerTargetingType = function getPartnerTargetingType() {
            return targetingType;
        };

        this.getSupportedAnalytics = function getSupportedAnalytics() {
            return supportedAnalytics;
        };

        this.getSupportedOptions = function getSupportedOptions() {
            return supportedOptions;
        };

        this.getPartnerDemandExpiry = function getPartnerDemandExpiry() {
            return supportedOptions.demandExpiry;
        };

        this.setPartnerTargetingType = function setPartnerTargetingType(tt) {
            if (!validateTargetingType(tt)) {
                return false;
            }

            targetingType = tt;

            return true;
        };

        function round(value) {
            /*
             * CPM is sent in dollars  (ex $12.50)
             * We compare against the rounding buckets (in dollars)
             * After we find the bucket we multiply by 100 to match our intepretation of price
             * Therefore a criteoRev of 12.50 for a 300x250 slot yields a target of 300x250_12.5
             */

            var precision = 1e6;
            var cpm = Math.round(Number(value) * precision) / precision;
            var granularity = 1;
            var highestBucket = 0;
            var lowestBucket = Number.POSITIVE_INFINITY;
            for (var i = 0, len = roundingBuckets.buckets.length; i < len; i++) {
                var bucket = roundingBuckets.buckets[i];
                if (bucket.range[0] < lowestBucket) {
                    lowestBucket = bucket.range[0];
                }
                if (bucket.range[1] > highestBucket) {
                    highestBucket = bucket.range[1];
                }
                if (cpm >= bucket.range[0] && cpm <= bucket.range[1]) {
                    granularity = bucket.granularity;
                    cpm = Math.round(cpm / granularity * precision) / precision;
                    cpm = Math.round(Math.floor(cpm) * precision) / precision;
                    cpm = Math.round(cpm * granularity * precision) / precision;
                    cpm = Math.round(cpm * 100 * precision) / precision; // convert to cent
                    cpm = Math.round(cpm);
                    return cpm;
                }
            }
            if (cpm < lowestBucket) {
                cpm = 0;
            } else if (cpm > highestBucket) {
                cpm = highestBucket;
            }
            return Math.floor(Math.round(cpm * 100 * precision) / precision);
        }

        function storeDemand(returnedDemand, currentDemand) {
            var targets = currentDemand || {
                slot: {}
            };

            if (Utils.isEmpty(returnedDemand)) {
                return targets;
            }

            var parsedDemand;
            try {
                parsedDemand = JSON.parse(returnedDemand);
            } catch (err) {
                //? if (DEBUG) {
                console.log('criteobidder.storeDemand: returned demand is not a valid json');
                //? }
                return targets;
            }

            var duplicateDemand = {};

            for (var i = 0; i < parsedDemand.slots.length; i++) {
                var demandSlot = parsedDemand.slots[i];
                if (!demandSlot.hasOwnProperty('cpm') || !demandSlot.hasOwnProperty('width') || !demandSlot.hasOwnProperty('height') ||
                    !demandSlot.hasOwnProperty('creative') || !demandSlot.hasOwnProperty('impid')) {
                    //? if (DEBUG) {
                    console.log('criteobidder.storeDemand: Returned Demand has missing parameters');
                    //? }
                    continue;
                }

                var impIdIndex = requestedImpIDs.indexOf(demandSlot.impid);
                if (impIdIndex === -1) {
                    //? if (DEBUG) {
                    console.log('criteobidder.storeDemand: impid returned is invalid');
                    //? }
                    continue;
                } else {
                    requestedImpIDs.splice(impIdIndex, 1);
                }

                var bucketCPM = round(demandSlot.cpm);
                if (bucketCPM === 0) {
                    continue;
                }

                var slotID = demandSlot.impid;
                var om = targetKeyOverride.om;
                var id = targetKeyOverride.id;

                var divID = slotID;
                var dimensions = demandSlot.width + 'x' + demandSlot.height;

                if (!duplicateDemand.hasOwnProperty(divID)) {
                    duplicateDemand[divID] = {};
                    duplicateDemand[divID][dimensions] = 1;
                } else if (!duplicateDemand[divID].hasOwnProperty(dimensions)) {
                    duplicateDemand[divID][dimensions] = 1;
                } else {
                    continue;
                }

                var slotInfo = targets.slot[divID] || {
                    timestamp: Utils.now(),
                    demand: {}
                };

                var slotAuctionID;
                if (slotInfo.demand.hasOwnProperty(om)) {
                    slotInfo.demand[om].push(dimensions + '_' + bucketCPM.toString());
                    slotAuctionID = slotInfo.demand[id];
                } else {
                    slotAuctionID = ++auctionID;
                    slotInfo.demand[om] = [dimensions + '_' + bucketCPM.toString()];
                    slotInfo.demand[id] = slotAuctionID;
                }

                targets.slot[divID] = slotInfo;
                ads[slotAuctionID] = ads[slotAuctionID] || {};
                ads[slotAuctionID][dimensions] = {
                    'html': demandSlot.creative
                };
            }

            return targets;
        }

        function generateSlots(divIDs) {
            var criteoSlots = [];

            for (var i = 0; i < divIDs.length; i++) {
                var slotname = divIDs[i];
                if (!configSlots.hasOwnProperty(slotname)) {
                    continue;
                }
                for (var j = 0; j < configSlots[slotname].length; j++) {
                    var zoneID = configSlots[slotname][j].zoneID;
                    if (!(validateQuotedInteger(zoneID) || Utils.isInteger(zoneID))) {
                        continue;
                    }
                    var impID = slotname;
                    requestedImpIDs.push(impID);
                    criteoSlots.push(new window.Criteo.PubTag.DirectBidding.DirectBiddingSlot(impID, Number(zoneID)));
                }
            }
            return criteoSlots;
        }

        this.prefetchDemand = function prefetchDemand(correlator, info, analyticsCallback) {
            prefetch.state = prefetchState.IN_PROGRESS;
            prefetch.correlator = correlator;
            prefetch.slotIds = info.divIds.slice();

            function prefetchSuccess(demand) {
                demandStore[correlator] = storeDemand(demand, demandStore[correlator]);
                prefetch.state = prefetchState.READY;

                analyticsCallback(correlator);

                for (var x = 0, lenx = prefetch.callbacks.length; x < lenx; x++) {
                    setTimeout(prefetch.callbacks[x], 0);
                }

            }

            function prefetchTimeout() {
                prefetch.state = prefetchState.READY;

                analyticsCallback(correlator);

                for (var x = 0, lenx = prefetch.callbacks.length; x < lenx; x++) {
                    setTimeout(prefetch.callbacks[x], 0);
                }

                return 'API error - timeout occurred';
            }

            function prefetchError(readyState, statusCode) {
                prefetch.state = prefetchState.READY;

                analyticsCallback(correlator);

                for (var x = 0, lenx = prefetch.callbacks.length; x < lenx; x++) {
                    setTimeout(prefetch.callbacks[x], 0);
                }

                return ' Request error - Status Code: ' + statusCode;
            }

            window.Criteo.events.push(function () {
                //Building and sending bid request
                var criteoSlots = generateSlots(prefetch.slotIds);

                var biddingEvent = new window.Criteo.PubTag.DirectBidding.DirectBiddingEvent(
                    profileID, new window.Criteo.PubTag.DirectBidding.DirectBiddingUrlBuilder(isAudit), criteoSlots,
                    prefetchSuccess, prefetchError, prefetchTimeout);

                window.criteo_pubtag.push(biddingEvent);
            });
        };

        this.getDemand = function getDemand(correlator, slots, callback) {
            if (prefetch.state === prefetchState.IN_PROGRESS) {
                var currentDivIds = Utils.getDivIds(slots);
                var prefetchInProgress = false;

                for (var x = 0, lenx = currentDivIds.length; x < lenx; x++) {
                    var slotIdIndex = prefetch.slotIds.indexOf(currentDivIds[x]);

                    if (slotIdIndex !== -1) {
                        prefetch.slotIds.splice(slotIdIndex, 1);
                        prefetchInProgress = true;
                    }
                }

                if (prefetchInProgress) {
                    prefetch.callbacks.push(getDemand.bind(_this, correlator, slots, callback));
                    return;
                }
            }

            var demand = {
                slot: {}
            };

            if (prefetch.state === prefetchState.READY) {
                if (demandStore.hasOwnProperty(prefetch.correlator) && demandStore[prefetch.correlator].hasOwnProperty('slot')) {
                    for (var i = slots.length - 1; i >= 0; i--) {
                        var divId = slots[i].getSlotElementId();

                        if (demandStore[prefetch.correlator].slot.hasOwnProperty(divId)) {
                            if (supportedOptions.demandExpiry < 0 || (Utils.now() - demandStore[prefetch.correlator].slot[divId].timestamp) <= supportedOptions.demandExpiry) {
                                demand.slot[divId] = demandStore[prefetch.correlator].slot[divId];
                                slots.splice(i, 1);
                            }

                            delete demandStore[prefetch.correlator].slot[divId];
                        }
                    }

                    if (!Utils.validateNonEmptyObject(demandStore[prefetch.correlator].slot)) {
                        prefetch.state = prefetchState.USED;
                    }
                }

                if (!slots.length) {
                    callback(null, demand);
                    return;
                }
            }

            function demandSuccess(returnedDemand) {
                demand = storeDemand(returnedDemand, demand);
                callback(null, demand);
            }

            function demandTimeout() {
                callback('API error - timeout occurred', demand);
            }

            function demandError(readyState, statusCode) {
                callback(' Request error - Status Code: ' + statusCode, demand);
            }

            window.Criteo.events.push(function () {
                var criteoSlots = generateSlots(Utils.getDivIds(slots));
                var biddingEvent = new window.Criteo.PubTag.DirectBidding.DirectBiddingEvent(
                    profileID, new window.Criteo.PubTag.DirectBidding.DirectBiddingUrlBuilder(isAudit), criteoSlots,
                    demandSuccess, demandError, demandTimeout);

                window.criteo_pubtag.push(biddingEvent);
            });
        };
    }

    window.headertag.registerPartner(PARTNER_ID, init);
})();
