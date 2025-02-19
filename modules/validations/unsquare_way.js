import { t } from '../util/locale';
import { actionChangeTags } from '../actions/change_tags';
import { actionOrthogonalize } from '../actions/orthogonalize';
import { geoOrthoCanOrthogonalize } from '../geo';
import { utilDisplayLabel } from '../util';
import { validationIssue, validationIssueFix } from '../core/validation';


export function validationUnsquareWay() {
    var type = 'unsquare_way';

    // use looser epsilon for detection to reduce false positives if nearly orthogonal
    var epsilon = 0.05;
    var degreeThreshold = 13;
    var nodeThreshold = 10;

    function isBuilding(entity, graph) {
        if (entity.type !== 'way' || entity.geometry(graph) !== 'area') return false;

        return entity.tags.building && entity.tags.building !== 'no';
    }


    var validation = function checkUnsquareWay(entity, context) {
        var graph = context.graph();
        if (!isBuilding(entity, graph)) return [];

        // don't flag ways marked as physically unsquare
        if (entity.tags.nonsquare === 'yes') return [];

        var isClosed = entity.isClosed();
        if (!isClosed) return [];        // this building has bigger problems

        // don't flag ways with lots of nodes since they are likely detail-mapped
        var nodes = context.childNodes(entity).slice();    // shallow copy
        if (nodes.length > nodeThreshold + 1) return [];   // +1 because closing node appears twice

        // ignore if not all nodes are fully downloaded
        var osm = context.connection();
        if (!osm || nodes.some(function(node) { return !osm.isDataLoaded(node.loc); })) return [];

        // don't flag connected ways to avoid unresolvable unsquare loops
        var hasConnectedSquarableWays = nodes.some(function(node) {
            return graph.parentWays(node).some(function(way) {
                if (way.id === entity.id) return false;
                if (isBuilding(way, graph)) return true;
                return graph.parentRelations(way).some(function(parentRelation) {
                    return parentRelation.isMultipolygon() &&
                        parentRelation.tags.building &&
                        parentRelation.tags.building !== 'no';
                });
            });
        });
        if (hasConnectedSquarableWays) return [];


        var points = nodes.map(function(node) { return context.projection(node.loc); });
        if (!geoOrthoCanOrthogonalize(points, isClosed, epsilon, degreeThreshold, true)) return [];

        // only allow autofix if there are no extra tags on the building (e.g. source) - #6288
        var autoArgs;
        if (Object.keys(entity.tags).length === 1) {
            // note: use default params for actionOrthogonalize, not relaxed epsilon
            var autoAction = actionOrthogonalize(entity.id, context.projection);
            autoAction.transitionable = false;  // when autofixing, do it instantly
            autoArgs = [autoAction, t('operations.orthogonalize.annotation.area')];
        }

        return [new validationIssue({
            type: type,
            severity: 'warning',
            message: function() {
                var entity = context.hasEntity(this.entityIds[0]);
                return entity ? t('issues.unsquare_way.message', { feature: utilDisplayLabel(entity, context) }) : '';
            },
            reference: showReference,
            entityIds: [entity.id],
            fixes: [
                new validationIssueFix({
                    icon: 'iD-operation-orthogonalize',
                    title: t('issues.fix.square_feature.title'),
                    autoArgs: autoArgs,
                    onClick: function() {
                        var entityId = this.issue.entityIds[0];
                        // note: use default params for actionOrthogonalize, not relaxed epsilon
                        context.perform(
                            actionOrthogonalize(entityId, context.projection),
                            t('operations.orthogonalize.annotation.area')
                        );
                    }
                }),
                new validationIssueFix({
                    title: t('issues.fix.tag_as_unsquare.title'),
                    onClick: function() {
                        var entityId = this.issue.entityIds[0];
                        var entity = context.entity(entityId);
                        var tags = Object.assign({}, entity.tags);  // shallow copy
                        tags.nonsquare = 'yes';
                        context.perform(
                            actionChangeTags(entityId, tags),
                            t('issues.fix.tag_as_unsquare.annotation')
                        );
                    }
                })
            ]
        })];

        function showReference(selection) {
            selection.selectAll('.issue-reference')
                .data([0])
                .enter()
                .append('div')
                .attr('class', 'issue-reference')
                .text(t('issues.unsquare_way.buildings.reference'));
        }
    };

    validation.type = type;

    return validation;
}
