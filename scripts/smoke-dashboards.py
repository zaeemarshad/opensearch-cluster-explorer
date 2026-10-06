#!/usr/bin/env python3
"""Compare the plugin's per-copy metrics with live OpenSearch shard statistics."""
import argparse
import json
import time
import urllib.error
import urllib.request
import urllib.parse

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--dashboards', default='http://127.0.0.1:15601')
parser.add_argument('--opensearch', default='http://127.0.0.1:19200')
parser.add_argument('--index', default='cluster-explorer-demo')
args = parser.parse_args()


def request(base, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(base.rstrip('/') + path, data=data,
                                 headers={'Content-Type': 'application/json', 'osd-xsrf': 'smoke'})
    for attempt in range(7):
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if error.code != 429 or attempt == 6:
                raise
            time.sleep(5)


index = urllib.parse.quote(args.index, safe='')
snapshot = request(args.dashboards, '/api/cluster_explorer/snapshot?scope=' + index)
assert snapshot['complete'], snapshot['sources']
assert snapshot['health']['nodes'] == 2, snapshot['health']
copies = [c for c in snapshot['copies'] if c['index'] == args.index and c['state'] == 'STARTED']
assert len(copies) == 6, f'Expected six started demo copies, found {len(copies)}'
stats = request(args.opensearch, '/' + index + '/_stats/docs,segments?level=shards')
primary_documents = 0
for copy in copies:
    selector = {key: copy[key] for key in ('index', 'indexUuid', 'shard', 'primary', 'node', 'allocationId')}
    details = request(args.dashboards, '/api/cluster_explorer/shard', selector)
    actual = next(s for s in stats['indices'][args.index]['shards'][str(copy['shard'])]
                  if s['routing']['node'] == copy['node'] and s['routing']['primary'] == copy['primary'])
    metrics = details['metrics']
    assert metrics is not None, details
    assert metrics['documents'] == actual['docs']['count'], (selector, metrics, actual)
    assert metrics['segments'] == actual['segments']['count'], (selector, metrics, actual)
    assert metrics['documents'] > 0 and metrics['segments'] > 0, metrics
    if copy['primary']:
        primary_documents += metrics['documents']
    print(f"shard {copy['shard']} {'primary' if copy['primary'] else 'replica'}: "
          f"{metrics['documents']} documents, {metrics['segments']} segments")
assert primary_documents == 300, primary_documents
print('PASS: all six plugin shard copies match live OpenSearch document and segment counts.')
