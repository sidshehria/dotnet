﻿/// <reference path="./node_modules/@types/jquery/index.d.ts">
/// <reference path="./node_modules/@types/extjs/index.d.ts">
/// <reference path="./node_modules/@types/microsoft-ajax/index.d.ts">
/// <reference path="./node_modules/@types/highlight.js/index.d.ts">
/// <reference path="./MiniProfiler.Globals.d.ts">

namespace StackExchange.Profiling {

    export interface Profiler {
        Id: string;
        Name: string;
        Started: Date;
        DurationMilliseconds: number;
        MachineName: string;
        CustomLinks: { [id: string]: string };
        Root: Timing;
        ClientTimings: ClientTimings;
        User: string;
        HasUserViewed: boolean;
        // Additive on client side
        CustomTimingStats: { [id: string]: CustomTimingStat };
        HasCustomTimings: boolean;
        HasDuplicateCustomTimings: boolean;
        HasTrivialTimings: boolean;
    }

    interface ClientTimings {
        Timings: ClientTiming[];
        RedirectCount: number;
    }

    class ClientTiming {
        Name: string;
        Start: number;
        Duration: number;
        constructor(name: string, start: number, duration?: number) {
            this.Name = name;
            this.Start = start;
            this.Duration = duration;
        }
    }

    interface Timing {
        Id: string;
        Name: string;
        DurationMilliseconds: number;
        StartMilliseconds: number;
        Children: Timing[];
        CustomTimings: { [id: string]: CustomTiming[] };
        // Additive on client side
        CustomTimingStats: { [id: string]: CustomTimingStat };
        DurationWithoutChildrenMilliseconds: number;
        Depth: number;
        HasCustomTimings: boolean;
        HasDuplicateCustomTimings: { [id: string]: boolean };
        IsTrivial: boolean;
        ParentTimingId?: string;
        // Added for gaps (TODO: change all this)
        parent: Timing;
        richTiming: GapTiming[];
    }

    interface CustomTiming {
        Id: string;
        CommandString: string;
        ExecuteType: string;
        StackTraceSnippet: string;
        StartMilliseconds: number;
        DurationMilliseconds: number;
        FirstFetchDurationMilliseconds?: number;
        Errored: boolean;
        // Client side:
        ParentTimingId: string;
        ParentTimingName: string;
        CallType: string;
        IsDuplicate: boolean;
        // Added for gaps
        prevGap: any;
        nextGap: any;
    }

    interface CustomTimingStat {
        Count: number;
        Duration: number;
    }

    interface TimingInfo {
        name: string;
        description: string;
        lineDescription: string;
        type: string;
        point: boolean;
    }

    interface Options {
        authorized: boolean;
        currentId: string;
        ids: string[];
        ignoredDuplicateExecuteTypes: string[];
        maxTracesToShow: number;
        path: string;
        renderPosition: string; // TODO: Enum
        showChildrenTime: boolean;
        showControls: boolean;
        showTrivial: boolean;
        startHidden: boolean;
        toggleShortcut: string;
        trivialMilliseconds: number;
        version: string;
    }

    interface ResultRequest {
        Id: string;
        Performance?: ClientTiming[];
        Probes?: ClientTiming[];
        RedirectCount?: number;
    }

    // Gaps
    interface GapTiming {
        start: number;
        finish: number;
        duration: number;
    }

    export class MiniProfiler {
        options: Options;
        container: JQuery;
        controls: JQuery;
        jq: JQueryStatic = window.jQuery.noConflict();
        fetchStatus: { [id: string]: string } = {}; // so we never pull down a profiler twice
        savedJson: Profiler[] = [];
        hasLocalStorage: boolean;
        path: string;
        clientPerfTimings: TimingInfo[] = [
            //{ name: 'navigationStart', description: 'Navigation Start' },
            //{ name: 'unloadEventStart', description: 'Unload Start' },
            //{ name: 'unloadEventEnd', description: 'Unload End' },
            //{ name: 'redirectStart', description: 'Redirect Start' },
            //{ name: 'redirectEnd', description: 'Redirect End' },
            <TimingInfo>({ name: 'fetchStart', description: 'Fetch Start', lineDescription: 'Fetch', point: true }),
            <TimingInfo>({ name: 'domainLookupStart', description: 'Domain Lookup Start', lineDescription: 'DNS Lookup', type: 'dns' }),
            <TimingInfo>({ name: 'domainLookupEnd', description: 'Domain Lookup End', type: 'dns' }),
            <TimingInfo>({ name: 'connectStart', description: 'Connect Start', lineDescription: 'Connect', type: 'connect' }),
            <TimingInfo>({ name: 'secureConnectionStart', description: 'Secure Connection Start', lineDescription: 'SSL/TLS Connect', type: 'ssl' }),
            <TimingInfo>({ name: 'connectEnd', description: 'Connect End', type: 'connect' }),
            <TimingInfo>({ name: 'requestStart', description: 'Request Start', lineDescription: 'Request', type: 'request' }),
            <TimingInfo>({ name: 'responseStart', description: 'Response Start', lineDescription: 'Response', type: 'request' }),
            <TimingInfo>({ name: 'responseEnd', description: 'Response End', type: 'response' }),
            <TimingInfo>({ name: 'domLoading', description: 'DOM Loading', lineDescription: 'DOM Loading', type: 'dom' }),
            <TimingInfo>({ name: 'domInteractive', description: 'DOM Interactive', lineDescription: 'DOM Interactive', type: 'dom', point: true }),
            <TimingInfo>({ name: 'domContentLoadedEventStart', description: 'DOM Content Loaded Event Start', lineDescription: 'DOM Content Loaded', type: 'domcontent' }),
            <TimingInfo>({ name: 'domContentLoadedEventEnd', description: 'DOM Content Loaded Event End', type: 'domcontent' }),
            <TimingInfo>({ name: 'domComplete', description: 'DOM Complete', lineDescription: 'DOM Complete', type: 'dom', point: true }),
            <TimingInfo>({ name: 'loadEventStart', description: 'Load Event Start', lineDescription: 'Load Event', type: 'load' }),
            <TimingInfo>({ name: 'loadEventEnd', description: 'Load Event End', type: 'load' }),
            <TimingInfo>({ name: 'firstPaintTime', description: 'First Paint', lineDescription: 'First Paint', type: 'paint', point: true }),
            <TimingInfo>({ name: 'firstContentfulPaintTime', description: 'First Content Paint', lineDescription: 'First Content Paint', type: 'paint', point: true })
        ];

        save = (keyPrefix: string, value: string) => {
            if (!this.hasLocalStorage) { return; }

            // clear old keys with this prefix, if any
            for (var i = 0; i < localStorage.length; i++) {
                if ((localStorage.key(i) || '').indexOf(keyPrefix) > -1) {
                    localStorage.removeItem(localStorage.key(i));
                }
            }

            // save under this version
            localStorage[keyPrefix + '-' + this.options.version] = value;
        };

        load = (keyPrefix: string) => {
            // for local dev, allow easy bypassing of cache
            if (!this.hasLocalStorage || window.location.href.indexOf('mpnocache=') > -1) { return null; }

            return localStorage[keyPrefix + '-' + this.options.version];
        };

        fetchTemplates = (success: Function) => {
            let key = 'templates',
                mp = this,
                cached = mp.load(key),
                $ = mp.jq;

            if (cached) {
                $('body').append(cached);
                success();
            }
            else {
                $.get(this.options.path + 'includes.tmpl?v=' + this.options.version, function (data: string) {
                    if (data) {
                        mp.save(key, data);
                        $('body').append(data);
                        success();
                    }
                });
            }
        };

        populatePerformanceTimings = (results: ResultRequest) => {
            if (window.performance && window.performance.timing) {
                let resource = window.performance.timing,
                    start = resource.fetchStart,
                    $ = this.jq;

                results.Performance = this.clientPerfTimings
                    .filter(function (current) { return resource[current.name] })
                    .map(function (current, i) { return { item: current, index: i } })
                    .sort(function (a, b) { return resource[a.item.name] - resource[b.item.name] || a.index - b.index; })
                    .map(function (x, i, sorted) {
                        var current = x.item;
                        var next = i + 1 < sorted.length ? sorted[i + 1].item : null;
                        // TODO: var clone { ...current };
                        return $.extend({
                            startTime: resource[current.name] - start,
                            timeTaken: !next ? 0 : (resource[next.name] - resource[current.name]),
                        }, current);
                    })
                    .map(function (item, i) {
                        return {
                            Name: item.name,
                            Start: item.startTime,
                            Duration: item.point ? undefined : item.timeTaken
                        };
                    });

                if (window.performance.navigation) {
                    results.RedirectCount = window.performance.navigation.redirectCount;
                }

                if (window.mPt) {
                    var pResults = window.mPt.results();
                    results.Probes = [];
                    for (var k in pResults) {
                        var result = pResults[k];
                        if (result.start && result.end) {
                            results.Probes.push({ Name: k, Start: result.start - start, Duration: result.end - result.start });
                        }
                    }
                    window.mPt.flush();
                }

                if (window.performance.getEntriesByType && window.PerformancePaintTiming) {
                    var entries = window.performance.getEntriesByType('paint');
                    for (let k = 0; k < entries.length; k++) {
                        var entry = entries[k];
                        switch (entry.name) {
                            case 'first-paint':
                                var firstPaint = new ClientTiming('firstPaintTime', Math.round(entry.startTime));
                                results.Performance.push(firstPaint);
                                break;
                            case 'first-contentful-paint':
                                var firstContentPaint = new ClientTiming('firstContentfulPaintTime', Math.round(entry.startTime));
                                break;
                        }
                    }
                    if (firstPaint && firstContentPaint && firstContentPaint.Start > firstPaint.Start) {
                        results.Performance.push(firstContentPaint);
                    }

                } else if (window.chrome && window.chrome.loadTimes) {
                    // fallback to Chrome timings
                    var chromeTimes = window.chrome.loadTimes();
                    if (chromeTimes.firstPaintTime) {
                        results.Performance.push(new ClientTiming('firstPaintTime', Math.round(chromeTimes.firstPaintTime * 1000 - start)));
                    }
                    if (chromeTimes.firstPaintAfterLoadTime && chromeTimes.firstPaintAfterLoadTime > chromeTimes.firstPaintTime) {
                        results.Performance.push(new ClientTiming('firstPaintAfterLoadTime', Math.round(chromeTimes.firstPaintAfterLoadTime * 1000 - start)));
                    }
                }
            }
        }

        fetchResults = (ids: string[]) => {
            let $ = this.jq;
            if (!ids) {
                return;
            }

            for (let i = 0; i < ids.length; i++) {
                var id = ids[i],
                    request: ResultRequest = { Id: id };

                if (id === this.options.currentId) {
                    this.populatePerformanceTimings(request);
                }

                let mp = this;
                let fs = this.fetchStatus;

                if (!fs.hasOwnProperty(id)) {
                    fs[id] = 'Starting fetch';

                    $.ajax({
                        url: this.options.path + 'results',
                        data: JSON.stringify(request),
                        dataType: 'json',
                        contentType: 'application/json',
                        type: 'POST',
                        success: function (json: Profiler | string) {
                            fs[id] = 'Fetch succeeded';
                            if (json instanceof String) {
                                // hidden
                            } else {
                                mp.buttonShow(<Profiler>json);
                            }
                        },
                        complete: function () {
                            fs[id] = 'Fetch complete';
                        }
                    });
                }
            }
        };

        processJson = (profiler: Profiler) => {

            let json: any = { ...profiler },
                mp = this;

            json.HasDuplicateCustomTimings = false;
            json.HasCustomTimings = false;
            json.HasTrivialTimings = false;
            json.ShowMoreColumns = this.options.showChildrenTime;
            json.ShowTrivial = this.options.showTrivial;
            json.CustomTimingStats = {};
            json.CustomLinks = json.CustomLinks || {};
            json.TrivialMilliseconds = this.options.trivialMilliseconds;
            json.Root.ParentTimingId = json.Id;
            json.Started = new Date(json.Started);

            function processTiming(json: Profiler, timing: Timing, depth: number) {
                timing.DurationWithoutChildrenMilliseconds = timing.DurationMilliseconds;
                timing.Depth = depth;
                timing.HasCustomTimings = timing.CustomTimings ? true : false;
                timing.HasDuplicateCustomTimings = {};
                json.HasCustomTimings = json.HasCustomTimings || timing.HasCustomTimings;

                if (timing.Children) {
                    for (var i = 0; i < timing.Children.length; i++) {
                        timing.Children[i].ParentTimingId = timing.Id;
                        processTiming(json, timing.Children[i], depth + 1);
                        timing.DurationWithoutChildrenMilliseconds -= timing.Children[i].DurationMilliseconds;
                    }
                } else {
                    timing.Children = [];
                }

                // do this after subtracting child durations
                timing.IsTrivial = timing.DurationWithoutChildrenMilliseconds < mp.options.trivialMilliseconds;
                json.HasTrivialTimings = json.HasTrivialTimings || timing.IsTrivial;

                function ignoreDuplicateCustomTiming(customTiming: CustomTiming) {
                    return customTiming.ExecuteType && mp.options.ignoredDuplicateExecuteTypes.indexOf(customTiming.ExecuteType) > -1;
                };

                if (timing.CustomTimings) {
                    timing.CustomTimingStats = {};
                    for (var customType in timing.CustomTimings) {
                        var customTimings = timing.CustomTimings[customType];
                        var customStat = {
                            Duration: 0,
                            Count: 0
                        };
                        var duplicates: { [id: string]: boolean } = {};
                        for (let i = 0; i < customTimings.length; i++) {
                            const customTiming: CustomTiming = customTimings[i];
                            customTiming.ParentTimingId = timing.Id;
                            customStat.Duration += customTiming.DurationMilliseconds;
                            customStat.Count++;
                            if (customTiming.CommandString && duplicates[customTiming.CommandString]) {
                                customTiming.IsDuplicate = true;
                                timing.HasDuplicateCustomTimings[customType] = true;
                                json.HasDuplicateCustomTimings = true;
                            } else if (!ignoreDuplicateCustomTiming(customTiming)) {
                                duplicates[customTiming.CommandString] = true;
                            }
                        }
                        timing.CustomTimingStats[customType] = customStat;
                        if (!json.CustomTimingStats[customType]) {
                            json.CustomTimingStats[customType] = {
                                Duration: 0,
                                Count: 0
                            };
                        }
                        json.CustomTimingStats[customType].Duration += customStat.Duration;
                        json.CustomTimingStats[customType].Count += customStat.Count;
                    }
                } else {
                    timing.CustomTimings = {};
                }
            };

            processTiming(json, json.Root, 0);

            return json;
        };

        renderTemplate = (json: Profiler) => this.jq('#profilerTemplate').tmpl(this.processJson(json));

        buttonShow = (json: Profiler) => {
            if (!this.container) {
                // container not rendered yet
                this.savedJson.push(json);
                return;
            }

            let result = this.renderTemplate(json).addClass('new');

            if (this.controls)
                result.insertBefore(this.controls);
            else
                result.appendTo(this.container);

            // limit count to maxTracesToShow, remove those before it
            this.container.find('.profiler-result:lt(' + -this.options.maxTracesToShow + ')').remove();
        };

        scrollToQuery = (link: JQuery, queries: JQuery, whatToScroll: JQuery) => {
            var id = link.closest('tr').data('timing-id'),
                rows = queries.find('tr[data-timing-id="' + id + '"]').addClass('highlight');

            // ensure they're in view
            whatToScroll.scrollTop(whatToScroll.scrollTop() + rows.position().top - 100);
        };

        // some elements want to be hidden on certain doc events
        bindDocumentEvents = () => {
            let $ = this.jq;
            $(document)
                .on('click', '.profiler-toggle-trivial', function (e) {
                    e.preventDefault();
                    $(this).closest('.profiler-result').toggleClass('show-trivial');
                }).on('click', '.profiler-toggle-columns', function (e) {
                    e.preventDefault();
                    $(this).closest('.profiler-result').toggleClass('show-columns');
                }).on('click', '.profiler-toggle-trivial-gaps', function (e) {
                    e.preventDefault();
                    $(this).closest('.profiler-queries').find('.profiler-trivial-gap').toggle();
                });

            // Don't handle below in the full page HTML view
            if ($('.profiler-result-full').length) {
                return;
            }
            var mp = this;
            $(document)
                .on('click', '.profiler-button', function (e) {
                    var button = $(this),
                        popup = button.siblings('.profiler-popup'),
                        wasActive = button.parent().hasClass('active');

                    button.parent().removeClass('new').toggleClass('active')
                        .siblings('.active').removeClass('active');

                    if (!wasActive) {
                        // move left or right, based on config
                        popup.css(mp.options.renderPosition.indexOf('left') != -1 ? 'left' : 'right', button.outerWidth() - 1);

                        // is this rendering on the bottom (if no, then is top by default)
                        if (mp.options.renderPosition.indexOf('bottom') != -1) {
                            var bottom = $(window).height() - button.offset().top - button.outerHeight() + $(window).scrollTop(); // get bottom of button
                            popup.css({ 'bottom': 0, 'max-height': 'calc(100vh - ' + (bottom + 25) + 'px)' });
                        }
                        else {
                            popup.css({ 'top': 0, 'max-height': 'calc(100vh - ' + (button.offset().top + 25) + 'px)' });
                        }
                    }
                }).on('click', '.profiler-queries-show', function (e) {
                    // opaque background
                    var overlay = $('<div class="profiler-overlay"><div class="profiler-overlay-bg"/></div>').appendTo('body');
                    var queries = $(this).closest('.profiler-result').find('.profiler-queries').clone().appendTo(overlay).show();

                    mp.scrollToQuery($(this), queries, queries);

                    // syntax highlighting
                    //prettyPrint();
                }).on('click keyup', function (e) {
                    var active = $('.profiler-result.active');
                    if (active.length) {
                        var bg = $('.profiler-overlay'),
                            isEscPress = e.type === 'keyup' && e.which === 27,
                            isBgClick = e.type === 'click' && !$(e.target).closest('.profiler-queries, .profiler-results').length

                        if (isEscPress || isBgClick) {
                            if (bg.is(':visible')) {
                                bg.remove();
                            }
                            else {
                                active.removeClass('active');
                            }
                        }
                    }
                });
            if (mp.options.toggleShortcut && !mp.options.toggleShortcut.match(/^None$/i)) {
                $(document).bind('keydown', mp.options.toggleShortcut, function (e) {
                    $('.profiler-results').toggle();
                });
            }
        };

        initControls = (container: JQuery) => {
            if (this.options.showControls) {
                this.controls = $('<div class="profiler-controls"><span class="profiler-min-max">m</span><span class="profiler-clear">c</span></div>').appendTo(container);

                $('.profiler-controls .profiler-min-max').click(function () {
                    container.toggleClass('profiler-min');
                });

                container.hover(
                    function () {
                        if ($(this).hasClass('profiler-min')) {
                            $(this).find('.profiler-min-max').show();
                        }
                    },
                    function () {
                        if ($(this).hasClass('profiler-min')) {
                            $(this).find('.profiler-min-max').hide();
                        }
                    });

                $('.profiler-controls .profiler-clear').click(function () {
                    container.find('.profiler-result').remove();
                });
            }
            else {
                container.addClass('profiler-no-controls');
            }
        };

        installAjaxHandlers = () => {
            // We simply don't support *really* old browsers: https://caniuse.com/#feat=json
            if (!window.JSON) {
                return;
            }

            let mp = this;

            function handleIds(jsonIds: string) {
                if (jsonIds) {
                    let ids: string[] = JSON.parse(jsonIds);
                    mp.fetchResults(ids);
                }
            }

            function handleXHR(xhr: XMLHttpRequest | JQuery.jqXHR) {
                // iframed file uploads don't have headers
                if (xhr && xhr.getResponseHeader) {
                    // should be an array of strings, e.g. ["008c4813-9bd7-443d-9376-9441ec4d6a8c","16ff377b-8b9c-4c20-a7b5-97cd9fa7eea7"]
                    handleIds(xhr.getResponseHeader('X-MiniProfiler-Ids'));
                }
            }

            // we need to attach our AJAX complete handler to the window's (profiled app's) copy, not our internal, no conflict version
            var window$ = window.jQuery;

            // fetch profile results for any AJAX calls
            if (window$ && window$(document) && window$(document).ajaxComplete) {
                window$(document).ajaxComplete(function(e: JQuery.Event<Document>, xhr: JQuery.jqXHR, settings: JQuery.AjaxSettings) {
                    handleXHR(xhr);
                });
            }

            // fetch results after ASP Ajax calls
            if (typeof (Sys) != 'undefined' && typeof (Sys.WebForms) != 'undefined' && typeof (Sys.WebForms.PageRequestManager) != 'undefined') {
                // Get the instance of PageRequestManager.
                var PageRequestManager = Sys.WebForms.PageRequestManager.getInstance();

                PageRequestManager.add_endRequest(function (sender: any, args: any) {
                    if (args) {
                        var response = args.get_response();
                        if (response.get_responseAvailable() && response._xmlHttpRequest != null) {
                            handleXHR(response);
                        }
                    }
                });
            }

            if (typeof (Sys) != 'undefined' && typeof (Sys.Net) != 'undefined' && typeof (Sys.Net.WebRequestManager) != 'undefined') {
                Sys.Net.WebRequestManager.add_completedRequest(function (sender: any, args: any) {
                    if (sender) {
                        var webRequestExecutor = sender;
                        if (webRequestExecutor.get_responseAvailable()) {
                            handleXHR(webRequestExecutor);
                        }
                    }
                });
            }

            // more Asp.Net callbacks
            if (typeof (window.WebForm_ExecuteCallback) === "function") {
                window.WebForm_ExecuteCallback = (function (callbackObject: any) {
                    // Store original function
                    var original = window.WebForm_ExecuteCallback;

                    return function (callbackObject: any) {
                        original(callbackObject);
                        handleXHR(callbackObject.xmlRequest);
                    };
                })(null);
            }

            // also fetch results after ExtJS requests, in case it is being used
            if (typeof (Ext) !== 'undefined' && typeof (Ext.Ajax) !== 'undefined' && typeof (Ext.Ajax.on) !== 'undefined') {
                // Ext.Ajax is a singleton, so we just have to attach to its 'requestcomplete' event
                Ext.Ajax.on('requestcomplete', function (e: any, xhr: XMLHttpRequest, settings: any) {
                    handleXHR(xhr);
                });
            }

            if (typeof (MooTools) !== 'undefined' && typeof (Request) !== 'undefined') {
                Request.prototype.addEvents({
                    onComplete: function () {
                        handleXHR(this.xhr);
                    }
                });
            }

            // add support for AngularJS, which uses the basic XMLHttpRequest object.
            if ((window.angular || window.axios || window.xhr) && typeof (XMLHttpRequest) !== 'undefined') {
                var _send = XMLHttpRequest.prototype.send;

                XMLHttpRequest.prototype.send = function sendReplacement(data) {
                    if (this.onreadystatechange) {
                        if (typeof (this.miniprofiler) === undefined || typeof (this.miniprofiler.prev_onreadystatechange) === undefined) {
                            this.miniprofiler = { prev_onreadystatechange: this.onreadystatechange };

                            this.onreadystatechange = function onReadyStateChangeReplacement() {
                                if (this.readyState === 4) {
                                    handleXHR(this);
                                }

                                if (this.miniprofiler.prev_onreadystatechange != null) {
                                    return this.miniprofiler.prev_onreadystatechange.apply(this, arguments);
                                }
                            };
                        }
                    }
                    else if (this.onload) {
                        if (typeof (this.miniprofiler) === undefined || typeof (this.miniprofiler.prev_onload) === undefined) {
                            this.miniprofiler = { prev_onload: this.onload };

                            this.onload = function onLoadReplacement() {
                                handleXHR(this);

                                if (this.miniprofiler.prev_onload != null) {
                                    return this.miniprofiler.prev_onload.apply(this, arguments);
                                }
                            };
                        }
                    }

                    return _send.apply(this, arguments);
                }
            }

            // wrap fetch
            if (window.fetch) {
                var windowFetch = window.fetch;
                window.fetch = function (input, init) {
                    return windowFetch(input, init).then(function (response) {
                        handleIds(response.headers.get('X-MiniProfiler-Ids'));
                        return response;
                    });
                };
            }
        };

        init = (): MiniProfiler => {
            this.jq = jQuery.noConflict(true);
            let $ = this.jq;
            var script = this.jq('#mini-profiler');
            if (!script.length) return;

            try {
                if ('localStorage' in window && window.localStorage !== null) {
                    window.localStorage.setItem('__localStorageTest__', '1');
                    window.localStorage.removeItem('__localStorageTest__');
                }
                this.hasLocalStorage = true;
            } catch (e) {
                this.hasLocalStorage = false;
            }

            let mp = this;
            var data = script.data();

            this.options = {
                ids: data.ids.split(','),
                path: data.path,
                version: data.version,
                renderPosition: data.position,
                showTrivial: data.trivial,
                trivialMilliseconds: parseFloat(data.trivialMilliseconds),
                showChildrenTime: data.children,
                maxTracesToShow: data.maxTraces,
                showControls: data.controls,
                currentId: data.currentId,
                authorized: data.authorized,
                toggleShortcut: data.toggleShortcut,
                startHidden: data.startHidden,
                ignoredDuplicateExecuteTypes: (data.ignoredDuplicateExecuteTypes || '').split(',')
            };

            function doInit() {
                function initFullView() {
                    // first, get jquery tmpl, then render and bind handlers
                    mp.fetchTemplates(function () {

                        // profiler will be defined in the full page's head
                        mp.renderTemplate(window.profiler).appendTo(mp.container);
                        //prettyPrint();

                        // since queries are already shown, just highlight and scroll when clicking a '1 sql' link
                        $('.profiler-popup').find('.profiler-queries-show').click(function () {
                            mp.scrollToQuery($(this), $('.profiler-queries'), $(document));
                        });
                    });
                };

                function initPopupView() {
                    if (mp.options.authorized) {
                        // all fetched profilers will go in here
                        // MiniProfiler.RenderIncludes() sets which corner to render in - default is upper left
                        mp.container = $('<div class="profiler-results"/>')
                            .addClass('profiler-' + mp.options.renderPosition)
                            .appendTo('body');

                        // initialize the controls
                        mp.initControls(mp.container);

                        // we'll render results JSON via a jquery.tmpl - after we get the templates, we'll fetch the initial JSON to populate it
                        mp.fetchTemplates(function () {
                            // get master page profiler results
                            mp.fetchResults(mp.options.ids);
                        });
                        if (mp.options.startHidden) {
                            mp.container.hide();
                        }

                        // if any data came in before the view popped up, render now
                        for (var i = 0; i < mp.savedJson.length; i++) {
                            mp.buttonShow(mp.savedJson[i]);
                        }
                    }
                    else {
                        mp.fetchResults(mp.options.ids);
                    }
                };

                // when rendering a shared, full page, this div will exist
                mp.container = $('.profiler-result-full');
                if (mp.container.length) {
                    if (window.location.href.indexOf('&trivial=1') > 0) {
                        mp.options.showTrivial = true
                    }
                    initFullView();
                }
                else {
                    initPopupView();
                }
                mp.bindDocumentEvents();
            };

            var wait = 0, alreadyDone = false;
            function deferInit() {
                if (alreadyDone) {
                    return;
                }
                if (window.performance && window.performance.timing && window.performance.timing.loadEventEnd === 0 && wait < 10000) {
                    setTimeout(deferInit, 100);
                    wait += 100;
                } else {
                    alreadyDone = true;
                    init();
                }
            };

            function init() {
                if (mp.options.authorized) {
                    var url = mp.options.path + 'includes.css?v=' + mp.options.version;
                    if (document.createStyleSheet) {
                        document.createStyleSheet(url);
                    } else {
                        $('head').append($('<link rel="stylesheet" type="text/css" href="' + url + '" />'));
                    }
                }
                doInit();
            };

            $(mp.installAjaxHandlers);
            $(deferInit);

            return this;
        };

        renderIndent = (depth: number) => {
            var result = '';
            for (var i = 0; i < depth; i++) {
                result += '&nbsp;';
            }
            return result;
        };

        shareUrl = (id: string) => {
            return this.options.path + 'results?id=' + id;
        };

        getClientTimings = (clientTimings: ClientTimings) => {
            if (!clientTimings.Timings) return [];

            let list = [],
                t: ClientTiming;

            for (var i = 0; i < clientTimings.Timings.length; i++) {
                t = clientTimings.Timings[i];
                let results = this.clientPerfTimings.filter(function (pt: TimingInfo) { return pt.name === t.Name; });
                var info = results.length > 0 ? results[0] : null;
                list.push(
                    {
                        isTrivial: t.Duration === 0 && !info.point,
                        name: info && info.lineDescription || t.Name,
                        duration: info && info.point ? undefined : t.Duration,
                        start: t.Start
                    });
            }

            list.sort(function (a, b) { return a.start - b.start; });
            return list;
        };

        getCustomTimings = (root: Timing) => {
            var result: CustomTiming[] = [];

            function addToResults(timing: Timing) {
                if (timing.CustomTimings) {
                    for (var customType in timing.CustomTimings) {
                        var customTimings = timing.CustomTimings[customType];

                        for (let i = 0, customTiming; i < customTimings.length; i++) {
                            let customTiming: CustomTiming = customTimings[i];

                            // HACK: add info about the parent Timing to each CustomTiming so UI can render
                            customTiming.ParentTimingName = timing.Name;
                            customTiming.CallType = customType;
                            result.push(customTiming);
                        }
                    }
                }

                if (timing.Children) {
                    for (let i = 0; i < timing.Children.length; i++) {
                        addToResults(timing.Children[i]);
                    }
                }
            };

            // start adding at the root and recurse down
            addToResults(root);
            result.sort((a, b) => a.StartMilliseconds - b.StartMilliseconds);

            function removeDuration(list: GapTiming[], duration: GapTiming) {

                var newList:GapTiming[] = [];
                for (var i = 0; i < list.length; i++) {

                    var item = list[i];
                    if (duration.start > item.start) {
                        if (duration.start > item.finish) {
                            newList.push(item);
                            continue;
                        }
                        newList.push(<GapTiming>({ start: item.start, finish: duration.start }));
                    }

                    if (duration.finish < item.finish) {
                        if (duration.finish < item.start) {
                            newList.push(item);
                            continue;
                        }
                        newList.push(<GapTiming>({ start: duration.finish, finish: item.finish }));
                    }
                }

                return newList;
            };

            function processTimes(elem: Timing, parent: Timing) {
                var duration = <GapTiming>({ start: elem.StartMilliseconds, finish: (elem.StartMilliseconds + elem.DurationMilliseconds) });
                elem.richTiming = [duration];
                if (parent != null) {
                    elem.parent = parent;
                    elem.parent.richTiming = removeDuration(elem.parent.richTiming, duration);
                }

                if (elem.Children) {
                    for (var i = 0; i < elem.Children.length; i++) {
                        processTimes(elem.Children[i], elem);
                    }
                }
            };

            processTimes(root, null);

            // sort results by time
            result.sort(function (a, b) { return a.StartMilliseconds - b.StartMilliseconds; });

            function determineOverlap(gap: GapTiming, node: Timing) {
                var overlap = 0;
                for (var i = 0; i < node.richTiming.length; i++) {
                    var current = node.richTiming[i];
                    if (current.start > gap.finish) {
                        break;
                    }
                    if (current.finish < gap.start) {
                        continue;
                    }

                    overlap += Math.min(gap.finish, current.finish) - Math.max(gap.start, current.start);
                }
                return overlap;
            };

            function determineGap(gap: GapTiming, node: Timing, match: any) {
                var overlap = determineOverlap(gap, node);
                if (match == null || overlap > match.duration) {
                    match = { name: node.Name, duration: overlap };
                }
                else if (match.name === node.Name) {
                    match.duration += overlap;
                }

                if (node.Children) {
                    for (var i = 0; i < node.Children.length; i++) {
                        match = determineGap(gap, node.Children[i], match);
                    }
                }
                return match;
            };

            var time = 0;
            var prev = null;
            result.forEach(function (elem) {
                elem.prevGap = {
                    duration: (elem.StartMilliseconds - time).toFixed(2),
                    start: time,
                    finish: elem.StartMilliseconds
                };

                elem.prevGap.topReason = determineGap(elem.prevGap, root, null);

                time = elem.StartMilliseconds + elem.DurationMilliseconds;
                prev = elem;
            });


            if (result.length > 0) {
                var me = result[result.length - 1];
                me.nextGap = {
                    duration: (root.DurationMilliseconds - time).toFixed(2),
                    start: time,
                    finish: root.DurationMilliseconds
                };
                me.nextGap.topReason = determineGap(me.nextGap, root, null);
            }

            return result;
        };

        formatDuration = (duration: number | undefined) => {
            if (duration === undefined) {
                return '';
            }
            return (duration || 0).toFixed(1);
        };

        escape = (orig: string) => orig.replace(/&/g, "&amp;")
                                       .replace(/</g, "&lt;")
                                       .replace(/>/g, "&gt;")
                                       .replace(/"/g, "&quot;")
                                       .replace(/'/g, "&#039;");

        listInit = (options: Options) => {
            let mp = this,
                $ = mp.jq,
                opt = this.options = options || <Options>{};

            function updateGrid(id?: string) {
                let getTiming = (profiler: Profiler, name: string) => 
                    profiler.ClientTimings.Timings.filter((t) => t.Name === name)[0] || { Name: name, Duration: '', Start: '' };

                $.ajax({
                    url: opt.path + 'results-list',
                    data: { 'last-id': id },
                    dataType: 'json',
                    type: 'GET',
                    success: function (data: Profiler[]) {
                        var str = '';
                        data.forEach((profiler) => {
                            str += (`
<tr>
  <td><a href="${options.path}results?id=${profiler.Id}">${escape(profiler.Name)}</a></td>
  <td>${escape(profiler.MachineName)}</td>
  <td class="profiler-results-index-date">${profiler.Started}</td>
  <td>${profiler.DurationMilliseconds}</td>` + (profiler.ClientTimings ? `
  <td>${getTiming(profiler, 'requestStart').Start}</td>
  <td>${getTiming(profiler, 'responseStart').Start}</td>
  <td>${getTiming(profiler, 'domComplete').Start}</td> ` : `
  <td colspan="3" class="profiler-results-none">(no client timings)</td>`) + `
</tr>`);
                        });
                        $('table tbody').append(str);
                        var oldId = id,
                            oldData = data;
                        setTimeout(function () {
                            var newId = oldId;
                            if (oldData.length > 0) {
                                newId = oldData[oldData.length - 1].Id;
                            }
                            updateGrid(newId);
                        }, 4000);
                    }
                });
            }
            updateGrid();
        };
    }
}

window.MiniProfiler = new StackExchange.Profiling.MiniProfiler().init();