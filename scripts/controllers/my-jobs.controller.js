
(function(){
    'use strict';

    var app = angular.module('topcat');

    app.controller('MyJobsController', function($rootScope, $q, $scope, $state, $stateParams, $uibModal, $interval, tc, helpers, uiGridConstants){

        var that = this;
        var pagingConfig = tc.config().paging;
        var isScroll = pagingConfig.pagingType == 'scroll';
        var pageSize = isScroll ? pagingConfig.scrollPageSize : pagingConfig.paginationNumberOfRows;
        var page = 1;
        var gridApi;
        var facilityName = $state.params.facilityName;
        this.userFacilities = tc.userFacilities();
        this.ijpFacilities = tc.ijpFacilities();
        this.selectedIjpFacility = this.ijpFacilities[0];

        if(!$state.params.facilityName){
            if (this.ijpFacilities.length > 0) {
                $state.go('home.my-jobs', {facilityName: this.ijpFacilities[0].config().name});
            } else {
                $state.go('home.my-jobs', {facilityName: this.userFacilities[0].config().name});
            }
            return;
        }

        var gridOptions = _.merge({
            data: [],
            appScopeProvider: this
            }, {
            "enableFiltering": true,
                "columnDefs": [
                    {
                        "field": "jobId"
                    },
                    {
                        "field": "name"
                    },
                    {
                        "field": "date"
                    },
                    {
                        "field": "status"
                    }
                ]
        });

        setUpGridOptions();
        this.gridOptions = gridOptions;
        this.isScroll = isScroll;
        if (this.ijpFacilities.length > 0) {
            refresh();
            var refreshInterval = $interval(refresh, 1000 * 30);
        }
        $scope.$on('$destroy', function(){
            $interval.cancel(refreshInterval);
        });

        $rootScope.$on('jobSubmitted', refresh);

        this.showJobDetailsModal = function(job){
            that.selectedJob = job;
            that.standardOutput = "";
            that.errorOutput = "";
            that.isLoadingStandardOutput = true;

            refreshJobOutput();
            that.jobDetailsModal = $uibModal.open({
                templateUrl : $stateParams.pluginUrl + 'views/job-details-modal.html',
                size: 'lg',
                scope: $scope
            });

            //Doesn't refresh job output if job is already completed or cancelled
            if (!job.status.match(/Completed|Cancelled/)){
                var refreshJobOutputInterval = $interval(refreshJobOutput, 1000 * 5);
                //Checks to see if the job is completed yet or has been cancelled, and stops refreshing job output if true
                var checkJobStatusInterval = $interval(function(){
                    if (_.find(gridOptions.data, function(j){ return j.jobId === that.selectedJob.jobId }).status.match(/Completed|Cancelled/)) {
                        $interval.cancel(refreshJobOutputInterval);
                        $interval.cancel(checkJobStatusInterval);
                    }
                }, 1000 * 5);
                //Stops refreshing job output on modal close
                that.jobDetailsModal.result.finally(function(){
                    $interval.cancel(refreshJobOutputInterval);
                    $interval.cancel(checkJobStatusInterval);
                });
            }
        };

        this.configureJob = function(ijpFacility){
            that.selectedIjpFacility = ijpFacility;
            ijpFacility.user().cart().then(function(cart){
                that.cartItems = cart.cartItems
                if(that.cartItems.length > 0) {
                    that.chooseJobInputsModal = $uibModal.open({
                        templateUrl : $stateParams.pluginUrl + 'views/choose-job-inputs-modal.html',
                        size : 'med',
                        scope: $scope
                    });
                } else {
                    that.openConfigureJobModal([]);
                }
            })
        };

        this.openConfigureJobModal = function(jobInputs) {
            if(this.chooseJobInputsModal) { this.chooseJobInputsModal.close() }
            $uibModal.open({
                templateUrl : $stateParams.pluginUrl + 'views/configure-job.html',
                controller: "ConfigureJobController as configureJobController",
                size : 'lg',
                resolve: {
                    inputEntities: function() { return jobInputs; },
                    facilityName: function() { return that.selectedIjpFacility.config().name; },
                    pluginUrl: function() { return $stateParams.pluginUrl; }
                }
            });
        }

        this.close = function(modal){
            modal.close();
        }

        this.deleteJob = function(job){
            tc.ijp(facilityName).deleteJob(String(job.jobId)).finally(function(){
                refresh();
            });
        }

        this.cancelJob = function(job){
            tc.ijp(facilityName).cancelJob(String(job.jobId)).finally(function(){
                refresh();
            });
        }

        function setUpGridOptions(){

            gridOptions.enableHorizontalScrollbar = uiGridConstants.scrollbars.NEVER;
            gridOptions.enableRowSelection =  false;
            gridOptions.enableRowHeaderSelection =  false;
            gridOptions.gridMenuShowHideColumns =  false;
            gridOptions.pageSize =  !that.isScroll ? pagingConfig.paginationNumberOfRows : null;
            gridOptions.paginationPageSizes =  pagingConfig.paginationPageSizes;
            gridOptions.paginationNumberOfRows =  pagingConfig.paginationNumberOfRows;
            gridOptions.enableFiltering = true;
            gridOptions.rowTemplate = '<div ng-click="grid.appScope.showJobDetailsModal(row.entity)" ng-repeat="(colRenderIndex, col) in colContainer.renderedColumns track by col.colDef.name" class="ui-grid-cell" ng-class="{ \'ui-grid-row-header-cell\': col.isRowHeader }" ui-grid-cell></div>';

            _.each(gridOptions.columnDefs, function(columnDef){
                columnDef.enableHiding = false;

                if(columnDef.field == 'date'){
                    columnDef.filters = [
                        {
                            "condition": function(filterDate, cellDate) {
                                if (filterDate == "") return true;
                                //Need to format dates so they are similar. Remove time from cellDate and remove double escapes from filterDate.
                                return new Date(cellDate.replace(/\s.*$/,'')) >= new Date(filterDate.replace(/\\/g,''));
                            },
                            "placeholder": "From..."
                        },
                        {
                            "condition": function(filterDate, cellDate) {
                                if (filterDate == "") return true;
                                //Need to format dates so they are similar. Remove time from cellDate and remove double escapes from filterDate.
                                return new Date(cellDate.replace(/\s.*$/,'')) <= new Date(filterDate.replace(/\\/g,''));
                            },
                            "placeholder": "To..."
                        }
                    ];
                    columnDef.filterHeaderTemplate = '<div class="ui-grid-filter-container" datetime-picker only-date ng-model="col.filters[0].term" placeholder="From..."></div><div class="ui-grid-filter-container" datetime-picker only-date ng-model="col.filters[1].term" placeholder="To..."></div>';
                    columnDef.sort = {
                        direction: uiGridConstants.DESC
                    };
                } else {
                    columnDef.filter = {
                        "condition": uiGridConstants.filter.CONTAINS,
                        "placeholder": "Containing...",
                        "type": "input"
                    };
                }

                columnDef.displayName = "MY_JOBS.COLUMN." + helpers.constantify(columnDef.field);
                columnDef.headerCellFilter = 'translate';

            });

            var actionButtons = '';
            actionButtons += '<button ng-if="row.entity.status === \'Completed\' || row.entity.status === \'Cancelled\'" class="btn btn-danger btn-xs" translate="MY_JOBS.COLUMN.ACTIONS.BUTTON.DELETE_JOB.TEXT" uib-tooltip="{{\'MY_JOBS.COLUMN.ACTIONS.BUTTON.DELETE_JOB.TOOLTIP.TEXT\' | translate}}" tooltip-placement="right" tooltip-append-to-body="true" ng-click="grid.appScope.deleteJob(row.entity); $event.stopPropagation();" ng-style="{ \'margin-right\':\'3px\' }"></button>';
            actionButtons += '<button ng-if="row.entity.status === \'Queued\' || row.entity.status === \'Executing\'" class="btn btn-warning btn-xs" translate="MY_JOBS.COLUMN.ACTIONS.BUTTON.CANCEL_JOB.TEXT" uib-tooltip="{{\'MY_JOBS.COLUMN.ACTIONS.BUTTON.CANCEL_JOB.TOOLTIP.TEXT\' | translate}}" tooltip-placement="right" tooltip-append-to-body="true" ng-click="grid.appScope.cancelJob(row.entity); $event.stopPropagation();" ng-style="{ \'margin-right\':\'3px\' }"></button>';
            gridOptions.columnDefs.push({
                name : 'actions',
                visible: true,
                title: 'MY_JOBS.COLUMN.ACTIONS.NAME',
                enableFiltering: false,
                enable: false,
                enableColumnMenu: false,
                enableSorting: false,
                enableHiding: false,
                cellTemplate : '<div class="ui-grid-cell-contents">' + actionButtons + '</div>'
            });

        }

        function getJobs() {
            that.isLoading = true;
            return tc.ijp(facilityName).getJob().then(function(results){
                that.isLoading = false;
                return results;
            });
        }

        function getStandardOutput() {
            tc.ijp(facilityName).getJobOutput(String(that.selectedJob.jobId)).then(function(standardOutput){
                that.standardOutput = standardOutput.output.replace(/\n/g,"<br />");
            }).finally(function(){
                that.isLoadingStandardOutput = false;
            });
        };

        function getErrorOutput() {
            tc.ijp(facilityName).getErrorOutput(String(that.selectedJob.jobId)).then(function(errorOutput){
                that.errorOutput = errorOutput.output.replace(/\n/g,"<br />");
            });
        };

        function refresh() {
            getJobs().then(function(results){
                gridOptions.data = results;
            });
        }

        function refreshJobOutput() {
            getStandardOutput();
            getErrorOutput();
        }

    });

})();