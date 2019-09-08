# -*- coding: utf-8 -*-
# Generated by Django 1.11.4 on 2017-08-26 07:14
from __future__ import unicode_literals

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('karaoke', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='song',
            name='song_year',
            field=models.IntegerField(db_index=True, null=True),
        ),
        migrations.AddField(
            model_name='song',
            name='is_mlk',
            field=models.BooleanField(default=False),
        ),
        migrations.AlterField(
            model_name='song',
            name='transcriber',
            field=models.CharField(max_length=255, null=True),
        ),
    ]
